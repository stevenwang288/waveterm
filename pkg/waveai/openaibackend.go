// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"

	"github.com/launchdarkly/eventsource"
	openaiapi "github.com/sashabaranov/go-openai"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type OpenAIBackend struct{}

var _ AIBackend = OpenAIBackend{}

const DefaultAzureAPIVersion = "2023-05-15"
const legacyCompatAPITypeOpenAIChat = "openai-chat"
const legacyCompatAPITypeOpenAIResponses = "openai-responses"

var openAIResponsesPreviousResponseIDs sync.Map

type openAIResponsesScopeKey struct {
	ClientID string
	BlockID  string
}

// copied from go-openai/config.go
func defaultAzureMapperFn(model string) string {
	return regexp.MustCompile(`[.:]`).ReplaceAllString(model, "")
}

func isReasoningModel(model string) bool {
	m := strings.ToLower(model)
	return strings.HasPrefix(m, "o1") ||
		strings.HasPrefix(m, "o3") ||
		strings.HasPrefix(m, "o4") ||
		strings.HasPrefix(m, "gpt-5") ||
		strings.HasPrefix(m, "gpt-5.1")
}

func normalizeReasoningEffort(level string) string {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "none", "minimal", "low", "medium", "high", "xhigh":
		return strings.ToLower(strings.TrimSpace(level))
	default:
		return ""
	}
}

func normalizeLegacyAPIType(apiType string) string {
	normalized := strings.ToLower(strings.TrimSpace(apiType))
	switch normalized {
	case legacyCompatAPITypeOpenAIChat:
		return APIType_OpenAI
	case legacyCompatAPITypeOpenAIResponses:
		// Keep accepting the older label on the classic OpenAI branch for
		// compatibility with callers that still normalize through setApiType.
		return APIType_OpenAI
	default:
		return normalized
	}
}

func setApiType(opts *wshrpc.WaveAIOptsType, clientConfig *openaiapi.ClientConfig) error {
	ourApiType := normalizeLegacyAPIType(opts.APIType)
	if ourApiType == "" || ourApiType == APIType_OpenAI || ourApiType == strings.ToLower(string(openaiapi.APITypeOpenAI)) {
		clientConfig.APIType = openaiapi.APITypeOpenAI
		return nil
	} else if ourApiType == strings.ToLower(string(openaiapi.APITypeAzure)) {
		clientConfig.APIType = openaiapi.APITypeAzure
		clientConfig.APIVersion = DefaultAzureAPIVersion
		clientConfig.AzureModelMapperFunc = defaultAzureMapperFn
		return nil
	} else if ourApiType == strings.ToLower(string(openaiapi.APITypeAzureAD)) {
		clientConfig.APIType = openaiapi.APITypeAzureAD
		clientConfig.APIVersion = DefaultAzureAPIVersion
		clientConfig.AzureModelMapperFunc = defaultAzureMapperFn
		return nil
	} else if ourApiType == strings.ToLower(string(openaiapi.APITypeCloudflareAzure)) {
		clientConfig.APIType = openaiapi.APITypeCloudflareAzure
		clientConfig.APIVersion = DefaultAzureAPIVersion
		clientConfig.AzureModelMapperFunc = defaultAzureMapperFn
		return nil
	} else {
		return fmt.Errorf("invalid api type %q", opts.APIType)
	}
}

func convertPrompt(prompt []wshrpc.WaveAIPromptMessageType) []openaiapi.ChatCompletionMessage {
	var rtn []openaiapi.ChatCompletionMessage
	for _, p := range prompt {
		msg := openaiapi.ChatCompletionMessage{Role: p.Role, Content: p.Content, Name: p.Name}
		rtn = append(rtn, msg)
	}
	return rtn
}

type openAIResponsesRequest struct {
	Model              string                        `json:"model"`
	Input              []openAIResponsesInputMessage `json:"input"`
	MaxOutputTokens    int                           `json:"max_output_tokens,omitempty"`
	PreviousResponseID string                        `json:"previous_response_id,omitempty"`
	Reasoning          *openAIResponsesReasoning     `json:"reasoning,omitempty"`
	Store              bool                          `json:"store,omitempty"`
	Stream             bool                          `json:"stream,omitempty"`
	Text               *openAIResponsesTextConfig    `json:"text,omitempty"`
	ToolChoice         string                        `json:"tool_choice,omitempty"`
}

type openAIResponsesReasoning struct {
	Effort string `json:"effort,omitempty"`
}

type openAIResponsesTextConfig struct {
	Format    openAIResponsesTextFormat `json:"format"`
	Verbosity string                    `json:"verbosity,omitempty"`
}

type openAIResponsesTextFormat struct {
	Type string `json:"type"`
}

type openAIResponsesInputMessage struct {
	Role    string                        `json:"role"`
	Content []openAIResponsesInputContent `json:"content"`
}

type openAIResponsesInputContent struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

type openAIResponsesResponse struct {
	ID                string                            `json:"id"`
	Model             string                            `json:"model"`
	CreatedAt         int64                             `json:"created_at"`
	Status            string                            `json:"status"`
	Output            []openAIResponsesOutputItem       `json:"output"`
	Usage             *openAIResponsesUsage             `json:"usage"`
	Error             *openAIResponsesError             `json:"error"`
	IncompleteDetails *openAIResponsesIncompleteDetails `json:"incomplete_details"`
}

type openAIResponsesOutputItem struct {
	Type    string                         `json:"type"`
	Role    string                         `json:"role,omitempty"`
	Content []openAIResponsesOutputContent `json:"content,omitempty"`
}

type openAIResponsesOutputContent struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

type openAIResponsesUsage struct {
	InputTokens  int `json:"input_tokens,omitempty"`
	OutputTokens int `json:"output_tokens,omitempty"`
	TotalTokens  int `json:"total_tokens,omitempty"`
}

type openAIResponsesError struct {
	Message string `json:"message,omitempty"`
}

type openAIResponsesIncompleteDetails struct {
	Reason string `json:"reason,omitempty"`
}

type openAIResponsesStreamEvent struct {
	Type     string                   `json:"type"`
	Delta    string                   `json:"delta,omitempty"`
	Response *openAIResponsesResponse `json:"response,omitempty"`
}

type openAIErrorResponse struct {
	Error openAIErrorPayload `json:"error"`
}

type openAIErrorPayload struct {
	Message string `json:"message"`
	Type    string `json:"type"`
	Code    string `json:"code"`
}

func isOpenAIResponsesAPIType(apiType string) bool {
	return strings.EqualFold(strings.TrimSpace(apiType), legacyCompatAPITypeOpenAIResponses)
}

func normalizeResponsesInputRole(role string) (string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(role))
	switch normalized {
	case "":
		return "user", true
	case "assistant", "developer", "system", "user":
		return normalized, true
	default:
		return "", false
	}
}

func convertPromptToResponsesInput(prompt []wshrpc.WaveAIPromptMessageType) []openAIResponsesInputMessage {
	var rtn []openAIResponsesInputMessage
	for _, message := range prompt {
		role, ok := normalizeResponsesInputRole(message.Role)
		if !ok || message.Content == "" {
			continue
		}
		contentType := "input_text"
		if role == "assistant" {
			contentType = "output_text"
		}
		rtn = append(rtn, openAIResponsesInputMessage{
			Role: role,
			Content: []openAIResponsesInputContent{
				{
					Type: contentType,
					Text: message.Content,
				},
			},
		})
	}
	return rtn
}

func makeOpenAIResponsesScopeKey(request wshrpc.WaveAIStreamRequest) (openAIResponsesScopeKey, bool) {
	clientID := strings.TrimSpace(request.ClientId)
	blockID := strings.TrimSpace(request.BlockId)
	if clientID == "" || blockID == "" {
		return openAIResponsesScopeKey{}, false
	}
	return openAIResponsesScopeKey{
		ClientID: clientID,
		BlockID:  blockID,
	}, true
}

func deleteOpenAIResponsesPreviousResponseID(request wshrpc.WaveAIStreamRequest) {
	scopeKey, ok := makeOpenAIResponsesScopeKey(request)
	if !ok {
		return
	}
	openAIResponsesPreviousResponseIDs.Delete(scopeKey)
}

func getOpenAIResponsesPreviousResponseID(request wshrpc.WaveAIStreamRequest) string {
	scopeKey, ok := makeOpenAIResponsesScopeKey(request)
	if !ok {
		return ""
	}
	if !promptContainsAssistantMessage(request.Prompt) {
		deleteOpenAIResponsesPreviousResponseID(request)
		return ""
	}
	if previousResponseID, ok := openAIResponsesPreviousResponseIDs.Load(scopeKey); ok {
		if responseID, ok := previousResponseID.(string); ok {
			return strings.TrimSpace(responseID)
		}
	}
	return ""
}

func rememberOpenAIResponsesPreviousResponseID(request wshrpc.WaveAIStreamRequest, responseID string) {
	scopeKey, ok := makeOpenAIResponsesScopeKey(request)
	responseID = strings.TrimSpace(responseID)
	if !ok || responseID == "" {
		return
	}
	openAIResponsesPreviousResponseIDs.Store(scopeKey, responseID)
}

func promptContainsAssistantMessage(prompt []wshrpc.WaveAIPromptMessageType) bool {
	for _, message := range prompt {
		role, ok := normalizeResponsesInputRole(message.Role)
		if ok && role == "assistant" && strings.TrimSpace(message.Content) != "" {
			return true
		}
	}
	return false
}

func trimPromptForResponsesTurn(
	prompt []wshrpc.WaveAIPromptMessageType,
	previousResponseID string,
) []wshrpc.WaveAIPromptMessageType {
	if strings.TrimSpace(previousResponseID) == "" {
		return prompt
	}

	lastAssistantIdx := -1
	for idx, message := range prompt {
		role, ok := normalizeResponsesInputRole(message.Role)
		if ok && role == "assistant" && strings.TrimSpace(message.Content) != "" {
			lastAssistantIdx = idx
		}
	}
	if lastAssistantIdx == -1 {
		return prompt
	}

	var trimmedPrompt []wshrpc.WaveAIPromptMessageType
	for idx, message := range prompt {
		role, ok := normalizeResponsesInputRole(message.Role)
		if !ok || strings.TrimSpace(message.Content) == "" {
			continue
		}
		if role == "system" || role == "developer" || idx > lastAssistantIdx {
			trimmedPrompt = append(trimmedPrompt, message)
		}
	}
	if len(trimmedPrompt) == 0 {
		return prompt
	}
	return trimmedPrompt
}

func normalizeOpenAIResponsesEndpoint(baseURL string) string {
	trimmed := strings.TrimSpace(baseURL)
	if trimmed == "" {
		return "/responses"
	}

	parsedURL, err := url.Parse(trimmed)
	if err != nil {
		return normalizeOpenAIResponsesPath(trimmed)
	}

	parsedURL.Path = normalizeOpenAIResponsesPath(parsedURL.Path)
	return strings.TrimRight(parsedURL.String(), "/")
}

func normalizeOpenAIResponsesPath(path string) string {
	trimmedPath := strings.TrimRight(strings.TrimSpace(path), "/")
	if trimmedPath == "" {
		return "/responses"
	}

	lowerPath := strings.ToLower(trimmedPath)
	switch {
	case strings.HasSuffix(lowerPath, "/v1/responses"):
		return trimmedPath
	case strings.HasSuffix(lowerPath, "/responses"):
		return trimmedPath
	case strings.HasSuffix(lowerPath, "/v1/chat/completions"):
		return trimmedPath[:len(trimmedPath)-len("/v1/chat/completions")] + "/v1/responses"
	case strings.HasSuffix(lowerPath, "/chat/completions"):
		return trimmedPath[:len(trimmedPath)-len("/chat/completions")] + "/responses"
	case strings.HasSuffix(lowerPath, "/v1"):
		return trimmedPath + "/responses"
	default:
		return trimmedPath + "/responses"
	}
}

func newOpenAIResponsesHTTPClient(proxyURL string) (*http.Client, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()

	// Custom OpenAI-compatible gateways have shown unstable second-turn behavior
	// over Go's HTTP/2 client path, so pin this responses chain to HTTP/1.1.
	// Some gateways still advertise HTTP/2 unless ALPN is explicitly narrowed.
	transport.ForceAttemptHTTP2 = false
	transport.TLSNextProto = make(map[string]func(string, *tls.Conn) http.RoundTripper)
	if transport.TLSClientConfig != nil {
		transport.TLSClientConfig = transport.TLSClientConfig.Clone()
	} else {
		transport.TLSClientConfig = &tls.Config{}
	}
	transport.TLSClientConfig.NextProtos = []string{"http/1.1"}
	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)
	transport.Protocols = protocols

	if strings.TrimSpace(proxyURL) != "" {
		parsedProxyURL, err := url.Parse(proxyURL)
		if err != nil {
			return nil, fmt.Errorf("invalid proxy URL: %v", err)
		}
		transport.Proxy = http.ProxyURL(parsedProxyURL)
	}

	return &http.Client{Transport: transport}, nil
}

func extractOpenAIResponsesText(response openAIResponsesResponse) string {
	var builder strings.Builder
	for _, item := range response.Output {
		if item.Type != "message" || item.Role != "assistant" {
			continue
		}
		for _, content := range item.Content {
			if content.Type != "output_text" || content.Text == "" {
				continue
			}
			builder.WriteString(content.Text)
		}
	}
	return builder.String()
}

func makeOpenAIResponsesUsage(usage *openAIResponsesUsage) *wshrpc.WaveAIUsageType {
	if usage == nil {
		return nil
	}
	return &wshrpc.WaveAIUsageType{
		PromptTokens:     usage.InputTokens,
		CompletionTokens: usage.OutputTokens,
		TotalTokens:      usage.TotalTokens,
	}
}

func makeOpenAIResponsesFinishReason(response openAIResponsesResponse) string {
	if response.IncompleteDetails != nil && response.IncompleteDetails.Reason != "" {
		return response.IncompleteDetails.Reason
	}
	switch strings.ToLower(strings.TrimSpace(response.Status)) {
	case "completed":
		return "stop"
	default:
		return strings.TrimSpace(response.Status)
	}
}

func makeOpenAIResponsesRequestBody(request wshrpc.WaveAIStreamRequest) (openAIResponsesRequest, string) {
	previousResponseID := getOpenAIResponsesPreviousResponseID(request)
	inputPrompt := trimPromptForResponsesTurn(request.Prompt, previousResponseID)
	reqBody := openAIResponsesRequest{
		Model:              request.Opts.Model,
		Input:              convertPromptToResponsesInput(inputPrompt),
		PreviousResponseID: previousResponseID,
		Store:              true,
		Stream:             true,
		Text: &openAIResponsesTextConfig{
			Format:    openAIResponsesTextFormat{Type: "text"},
			Verbosity: "medium",
		},
		ToolChoice: "auto",
	}
	if request.Opts.MaxTokens > 0 {
		reqBody.MaxOutputTokens = request.Opts.MaxTokens
	}

	appliedReasoningEffort := ""
	if isReasoningModel(request.Opts.Model) {
		if effort := normalizeReasoningEffort(request.Opts.ThinkingLevel); effort != "" {
			reqBody.Reasoning = &openAIResponsesReasoning{Effort: effort}
			appliedReasoningEffort = effort
		}
	}
	return reqBody, appliedReasoningEffort
}

func shouldParseOpenAIResponsesSSE(contentType string, body []byte) bool {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(contentType)), "text/event-stream") {
		return true
	}
	trimmedBody := bytes.TrimSpace(body)
	return bytes.HasPrefix(trimmedBody, []byte("event:")) || bytes.HasPrefix(trimmedBody, []byte("data:"))
}

func decodeOpenAIResponsesJSONBody(
	body []byte,
	rtn chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType],
) (string, error) {
	var apiResp openAIResponsesResponse
	if err := json.Unmarshal(body, &apiResp); err != nil {
		bodySnippet := strings.TrimSpace(string(body))
		if len(bodySnippet) > 160 {
			bodySnippet = bodySnippet[:160] + "..."
		}
		return "", fmt.Errorf("error decoding openai responses API body: %v (body: %s)", err, bodySnippet)
	}
	if err := emitOpenAIResponsesFinalPacket(apiResp, "", rtn, false); err != nil {
		return "", err
	}
	return apiResp.ID, nil
}

func decodeOpenAIResponsesSSEStream(
	reader io.Reader,
	rtn chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType],
) (string, error) {
	decoder := eventsource.NewDecoder(reader)
	var aggregatedText strings.Builder
	sentHeader := false

	for {
		event, err := decoder.Decode()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return "", fmt.Errorf("error decoding openai responses API SSE stream: %v", err)
		}

		data := strings.TrimSpace(event.Data())
		if data == "" {
			continue
		}
		if data == "[DONE]" {
			break
		}

		var streamEvent openAIResponsesStreamEvent
		if err := json.Unmarshal([]byte(data), &streamEvent); err != nil {
			return "", fmt.Errorf("error decoding openai responses SSE event %q: %v", strings.TrimSpace(event.Event()), err)
		}

		eventName := strings.TrimSpace(event.Event())
		if eventName == "" {
			eventName = strings.TrimSpace(streamEvent.Type)
		}

		switch eventName {
		case "response.created":
			if streamEvent.Response != nil {
				emitOpenAIResponsesHeader(*streamEvent.Response, rtn, &sentHeader)
			}
		case "response.output_text.delta":
			aggregatedText.WriteString(streamEvent.Delta)
		case "response.completed":
			if streamEvent.Response == nil {
				return "", errors.New("openai responses API SSE response.completed missing response payload")
			}
			if err := emitOpenAIResponsesFinalPacket(*streamEvent.Response, aggregatedText.String(), rtn, sentHeader); err != nil {
				return "", err
			}
			return streamEvent.Response.ID, nil
		case "response.failed":
			return "", makeOpenAIResponsesSSEError("failed", streamEvent.Response)
		case "response.incomplete":
			return "", makeOpenAIResponsesSSEError("incomplete", streamEvent.Response)
		}
	}

	return "", errors.New("openai responses API stream ended before response.completed")
}

func emitOpenAIResponsesHeader(
	response openAIResponsesResponse,
	rtn chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType],
	sentHeader *bool,
) {
	if sentHeader == nil || *sentHeader {
		return
	}
	if response.Model == "" && response.CreatedAt == 0 {
		return
	}

	header := MakeWaveAIPacket()
	header.Model = response.Model
	header.Created = response.CreatedAt
	rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *header}
	*sentHeader = true
}

func emitOpenAIResponsesFinalPacket(
	response openAIResponsesResponse,
	finalText string,
	rtn chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType],
	sentHeader bool,
) error {
	if response.Error != nil && response.Error.Message != "" {
		return fmt.Errorf("openai responses API error: %s", response.Error.Message)
	}

	headerEmitted := sentHeader
	emitOpenAIResponsesHeader(response, rtn, &headerEmitted)

	if finalText == "" {
		finalText = extractOpenAIResponsesText(response)
	}
	if finalText == "" && response.IncompleteDetails == nil {
		return errors.New("openai responses API returned no assistant text")
	}

	packet := MakeWaveAIPacket()
	packet.Text = finalText
	packet.FinishReason = makeOpenAIResponsesFinishReason(response)
	packet.Usage = makeOpenAIResponsesUsage(response.Usage)
	rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *packet}
	return nil
}

func makeOpenAIResponsesSSEError(state string, response *openAIResponsesResponse) error {
	if response == nil {
		return fmt.Errorf("openai responses API %s", state)
	}
	if state == "failed" {
		if response.Error != nil && response.Error.Message != "" {
			return fmt.Errorf("openai responses API failed: %s", response.Error.Message)
		}
		if response.Status != "" {
			return fmt.Errorf("openai responses API failed with status %q", response.Status)
		}
		return errors.New("openai responses API failed")
	}

	if response.IncompleteDetails != nil && response.IncompleteDetails.Reason != "" {
		return fmt.Errorf("openai responses API incomplete: %s", response.IncompleteDetails.Reason)
	}
	if response.Status != "" {
		return fmt.Errorf("openai responses API incomplete with status %q", response.Status)
	}
	return errors.New("openai responses API incomplete")
}

func parseOpenAIHTTPError(resp *http.Response) error {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("openai %s: failed to read error response: %v", resp.Status, err)
	}

	var errorResp openAIErrorResponse
	if err := json.Unmarshal(body, &errorResp); err == nil && errorResp.Error.Message != "" {
		return fmt.Errorf("openai %s: %s", resp.Status, errorResp.Error.Message)
	}

	trimmedBody := strings.TrimSpace(string(body))
	if len(trimmedBody) > 160 {
		trimmedBody = trimmedBody[:160] + "..."
	}
	if trimmedBody == "" {
		trimmedBody = http.StatusText(resp.StatusCode)
	}
	return fmt.Errorf("openai %s: %s", resp.Status, trimmedBody)
}

func (OpenAIBackend) streamResponsesCompletion(
	ctx context.Context,
	request wshrpc.WaveAIStreamRequest,
	rtn chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType],
) {
	endpoint := normalizeOpenAIResponsesEndpoint(request.Opts.BaseURL)
	reqBody, appliedReasoningEffort := makeOpenAIResponsesRequestBody(request)

	log.Printf(
		"openai responses request model=%s endpoint=%q thinking=%q reasoning_effort=%q previous_response_id=%q max_output_tokens=%d\n",
		request.Opts.Model,
		endpoint,
		request.Opts.ThinkingLevel,
		appliedReasoningEffort,
		reqBody.PreviousResponseID,
		reqBody.MaxOutputTokens,
	)

	payload, err := json.Marshal(reqBody)
	if err != nil {
		rtn <- makeAIError(fmt.Errorf("error marshaling openai responses request: %v", err))
		return
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		rtn <- makeAIError(fmt.Errorf("error creating openai responses request: %v", err))
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json, text/event-stream")
	if request.Opts.APIToken != "" {
		httpReq.Header.Set("Authorization", "Bearer "+request.Opts.APIToken)
	}
	if request.Opts.OrgID != "" {
		httpReq.Header.Set("OpenAI-Organization", request.Opts.OrgID)
	}

	httpClient, err := newOpenAIResponsesHTTPClient(request.Opts.ProxyURL)
	if err != nil {
		rtn <- makeAIError(err)
		return
	}

	resp, err := httpClient.Do(httpReq)
	if err != nil {
		rtn <- makeAIError(fmt.Errorf("error calling openai responses API: %v", err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		rtn <- makeAIError(parseOpenAIHTTPError(resp))
		return
	}

	var (
		decodeErr  error
		responseID string
	)
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type"))), "text/event-stream") {
		responseID, decodeErr = decodeOpenAIResponsesSSEStream(resp.Body, rtn)
	} else {
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			rtn <- makeAIError(fmt.Errorf("error reading openai responses API body: %v", err))
			return
		}
		if shouldParseOpenAIResponsesSSE(resp.Header.Get("Content-Type"), body) {
			responseID, decodeErr = decodeOpenAIResponsesSSEStream(bytes.NewReader(body), rtn)
		} else {
			responseID, decodeErr = decodeOpenAIResponsesJSONBody(body, rtn)
		}
	}
	if decodeErr != nil {
		rtn <- makeAIError(decodeErr)
		return
	}
	rememberOpenAIResponsesPreviousResponseID(request, responseID)
}

func (OpenAIBackend) StreamCompletion(ctx context.Context, request wshrpc.WaveAIStreamRequest) chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType] {
	rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType])
	go func() {
		defer func() {
			panicErr := panichandler.PanicHandler("OpenAIBackend.StreamCompletion", recover())
			if panicErr != nil {
				rtn <- makeAIError(panicErr)
			}
			close(rtn)
		}()
		if request.Opts == nil {
			rtn <- makeAIError(errors.New("no openai opts found"))
			return
		}
		if request.Opts.Model == "" {
			rtn <- makeAIError(errors.New("no openai model specified"))
			return
		}
		if request.Opts.BaseURL == "" && request.Opts.APIToken == "" {
			rtn <- makeAIError(errors.New("no api token"))
			return
		}
		if isOpenAIResponsesAPIType(request.Opts.APIType) {
			OpenAIBackend{}.streamResponsesCompletion(ctx, request, rtn)
			return
		}

		clientConfig := openaiapi.DefaultConfig(request.Opts.APIToken)
		if request.Opts.BaseURL != "" {
			clientConfig.BaseURL = request.Opts.BaseURL
		}
		err := setApiType(request.Opts, &clientConfig)
		if err != nil {
			rtn <- makeAIError(err)
			return
		}
		if request.Opts.OrgID != "" {
			clientConfig.OrgID = request.Opts.OrgID
		}
		if request.Opts.APIVersion != "" {
			clientConfig.APIVersion = request.Opts.APIVersion
		}

		// Configure proxy if specified
		if request.Opts.ProxyURL != "" {
			proxyURL, err := url.Parse(request.Opts.ProxyURL)
			if err != nil {
				rtn <- makeAIError(fmt.Errorf("invalid proxy URL: %v", err))
				return
			}
			transport := &http.Transport{
				Proxy: http.ProxyURL(proxyURL),
			}
			clientConfig.HTTPClient = &http.Client{
				Transport: transport,
			}
		}

		client := openaiapi.NewClientWithConfig(clientConfig)
		req := openaiapi.ChatCompletionRequest{
			Model:    request.Opts.Model,
			Messages: convertPrompt(request.Prompt),
		}

		appliedReasoningEffort := ""

		// Set MaxCompletionTokens for reasoning models, MaxTokens for others
		if isReasoningModel(request.Opts.Model) {
			req.MaxCompletionTokens = request.Opts.MaxTokens
			if effort := normalizeReasoningEffort(request.Opts.ThinkingLevel); effort != "" {
				req.ReasoningEffort = effort
				appliedReasoningEffort = effort
			}
		} else {
			req.MaxTokens = request.Opts.MaxTokens
		}

		log.Printf(
			"openai backend request model=%s thinking=%q reasoning_effort=%q max_tokens=%d max_completion_tokens=%d\n",
			request.Opts.Model,
			request.Opts.ThinkingLevel,
			appliedReasoningEffort,
			req.MaxTokens,
			req.MaxCompletionTokens,
		)

		req.Stream = true
		if request.Opts.MaxChoices > 1 {
			req.N = request.Opts.MaxChoices
		}

		apiResp, err := client.CreateChatCompletionStream(ctx, req)
		if err != nil {
			rtn <- makeAIError(fmt.Errorf("error calling openai API: %v", err))
			return
		}
		sentHeader := false
		for {
			streamResp, err := apiResp.Recv()
			if err == io.EOF {
				break
			}
			if err != nil {
				rtn <- makeAIError(fmt.Errorf("OpenAI request, error reading message: %v", err))
				break
			}
			if streamResp.Model != "" && !sentHeader {
				pk := MakeWaveAIPacket()
				pk.Model = streamResp.Model
				pk.Created = streamResp.Created
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *pk}
				sentHeader = true
			}
			for _, choice := range streamResp.Choices {
				pk := MakeWaveAIPacket()
				pk.Index = choice.Index
				pk.Text = choice.Delta.Content
				pk.FinishReason = string(choice.FinishReason)
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *pk}
			}
		}
	}()
	return rtn
}
