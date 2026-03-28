package waveai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	openaiapi "github.com/sashabaranov/go-openai"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestNewOpenAIResponsesHTTPClientPinsTLSALPNToHTTP11(t *testing.T) {
	client, err := newOpenAIResponsesHTTPClient("")
	if err != nil {
		t.Fatalf("newOpenAIResponsesHTTPClient returned error: %v", err)
	}

	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("client transport type = %T, want *http.Transport", client.Transport)
	}
	if transport.ForceAttemptHTTP2 {
		t.Fatalf("ForceAttemptHTTP2 = true, want false")
	}
	if transport.TLSClientConfig == nil {
		t.Fatalf("TLSClientConfig = nil, want explicit HTTP/1.1 ALPN config")
	}
	if len(transport.TLSClientConfig.NextProtos) != 1 || transport.TLSClientConfig.NextProtos[0] != "http/1.1" {
		t.Fatalf("TLSClientConfig.NextProtos = %#v, want [\"http/1.1\"]", transport.TLSClientConfig.NextProtos)
	}
}

func TestNormalizeReasoningEffort(t *testing.T) {
	testCases := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: ""},
		{name: "trimmed high", input: " High ", want: "high"},
		{name: "minimal", input: "minimal", want: "minimal"},
		{name: "xhigh", input: "xhigh", want: "xhigh"},
		{name: "invalid", input: "turbo", want: ""},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			got := normalizeReasoningEffort(testCase.input)
			if got != testCase.want {
				t.Fatalf("normalizeReasoningEffort(%q) = %q, want %q", testCase.input, got, testCase.want)
			}
		})
	}
}

func TestSetApiTypeAcceptsOpenAIResponsesCompatAlias(t *testing.T) {
	opts := &wshrpc.WaveAIOptsType{APIType: legacyCompatAPITypeOpenAIResponses}
	var clientConfig openaiapi.ClientConfig

	err := setApiType(opts, &clientConfig)
	if err != nil {
		t.Fatalf("setApiType(%q) returned error: %v", opts.APIType, err)
	}
	if clientConfig.APIType != openaiapi.APITypeOpenAI {
		t.Fatalf("setApiType(%q) APIType = %q, want %q", opts.APIType, clientConfig.APIType, openaiapi.APITypeOpenAI)
	}
}

func TestSetApiTypeAcceptsOpenAIChatCompatAlias(t *testing.T) {
	opts := &wshrpc.WaveAIOptsType{APIType: legacyCompatAPITypeOpenAIChat}
	var clientConfig openaiapi.ClientConfig

	err := setApiType(opts, &clientConfig)
	if err != nil {
		t.Fatalf("setApiType(%q) returned error: %v", opts.APIType, err)
	}
	if clientConfig.APIType != openaiapi.APITypeOpenAI {
		t.Fatalf("setApiType(%q) APIType = %q, want %q", opts.APIType, clientConfig.APIType, openaiapi.APITypeOpenAI)
	}
}

func TestSetApiTypeRejectsUnknownValue(t *testing.T) {
	opts := &wshrpc.WaveAIOptsType{APIType: "definitely-unknown"}
	var clientConfig openaiapi.ClientConfig

	err := setApiType(opts, &clientConfig)
	if err == nil {
		t.Fatalf("setApiType(%q) unexpectedly succeeded", opts.APIType)
	}
	if !strings.Contains(err.Error(), `invalid api type "definitely-unknown"`) {
		t.Fatalf("setApiType(%q) error = %q, want invalid api type message", opts.APIType, err)
	}
}

func TestCodexAPITypeMatchesRequestAcceptsOpenAIChatCompatLabel(t *testing.T) {
	if !codexAPITypeMatchesRequest(legacyCompatAPITypeOpenAIChat, APIType_OpenAI) {
		t.Fatalf("codexAPITypeMatchesRequest(%q, %q) = false, want true", legacyCompatAPITypeOpenAIChat, APIType_OpenAI)
	}
	if !codexAPITypeMatchesRequest(legacyCompatAPITypeOpenAIChat, legacyCompatAPITypeOpenAIResponses) {
		t.Fatalf("codexAPITypeMatchesRequest(%q, %q) = false, want true", legacyCompatAPITypeOpenAIChat, legacyCompatAPITypeOpenAIResponses)
	}
}

func TestNormalizeOpenAIResponsesEndpoint(t *testing.T) {
	testCases := []struct {
		name    string
		baseURL string
		want    string
	}{
		{
			name:    "root endpoint",
			baseURL: "https://example.com",
			want:    "https://example.com/responses",
		},
		{
			name:    "v1 endpoint",
			baseURL: "https://example.com/v1",
			want:    "https://example.com/v1/responses",
		},
		{
			name:    "chat completions endpoint",
			baseURL: "https://example.com/v1/chat/completions",
			want:    "https://example.com/v1/responses",
		},
		{
			name:    "already responses endpoint",
			baseURL: "https://example.com/v1/responses",
			want:    "https://example.com/v1/responses",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			got := normalizeOpenAIResponsesEndpoint(testCase.baseURL)
			if got != testCase.want {
				t.Fatalf("normalizeOpenAIResponsesEndpoint(%q) = %q, want %q", testCase.baseURL, got, testCase.want)
			}
		})
	}
}

func TestConvertPromptToResponsesInputUsesOutputTextForAssistantHistory(t *testing.T) {
	prompt := []wshrpc.WaveAIPromptMessageType{
		{Role: "user", Content: "你好"},
		{Role: "assistant", Content: "你好！有什么我可以帮你的吗？"},
		{Role: "user", Content: "你是谁"},
	}

	got := convertPromptToResponsesInput(prompt)
	if len(got) != 3 {
		t.Fatalf("convertPromptToResponsesInput len = %d, want 3", len(got))
	}
	if got[0].Content[0].Type != "input_text" {
		t.Fatalf("user content type = %q, want input_text", got[0].Content[0].Type)
	}
	if got[1].Content[0].Type != "output_text" {
		t.Fatalf("assistant content type = %q, want output_text", got[1].Content[0].Type)
	}
	if got[2].Content[0].Type != "input_text" {
		t.Fatalf("follow-up user content type = %q, want input_text", got[2].Content[0].Type)
	}
}

func TestConvertPromptToResponsesInputDropsUnsupportedRoles(t *testing.T) {
	prompt := []wshrpc.WaveAIPromptMessageType{
		{Role: "error", Content: "上游错误"},
		{Role: "tool", Content: "tool output"},
		{Role: "user", Content: "继续"},
	}

	got := convertPromptToResponsesInput(prompt)
	if len(got) != 1 {
		t.Fatalf("convertPromptToResponsesInput len = %d, want 1", len(got))
	}
	if got[0].Role != "user" {
		t.Fatalf("remaining role = %q, want user", got[0].Role)
	}
	if got[0].Content[0].Type != "input_text" {
		t.Fatalf("remaining content type = %q, want input_text", got[0].Content[0].Type)
	}
	if got[0].Content[0].Text != "继续" {
		t.Fatalf("remaining content text = %q, want 继续", got[0].Content[0].Text)
	}
}

func TestConvertPromptToResponsesInputDefaultsEmptyRoleAndDropsEmptyContent(t *testing.T) {
	prompt := []wshrpc.WaveAIPromptMessageType{
		{Role: "", Content: "匿名历史"},
		{Role: "system", Content: "系统提示"},
		{Role: "assistant", Content: ""},
	}

	got := convertPromptToResponsesInput(prompt)
	if len(got) != 2 {
		t.Fatalf("convertPromptToResponsesInput len = %d, want 2", len(got))
	}
	if got[0].Role != "user" {
		t.Fatalf("empty role converted to %q, want user", got[0].Role)
	}
	if got[0].Content[0].Type != "input_text" {
		t.Fatalf("empty role content type = %q, want input_text", got[0].Content[0].Type)
	}
	if got[1].Role != "system" {
		t.Fatalf("system role = %q, want system", got[1].Role)
	}
	if got[1].Content[0].Type != "input_text" {
		t.Fatalf("system content type = %q, want input_text", got[1].Content[0].Type)
	}
}

func TestMakeOpenAIResponsesRequestBodyIncludesProviderCompatibleTextDefaults(t *testing.T) {
	request := wshrpc.WaveAIStreamRequest{
		Prompt: []wshrpc.WaveAIPromptMessageType{
			{Role: "user", Content: "你好"},
			{Role: "assistant", Content: "你好！有什么我可以帮你的吗？"},
			{Role: "user", Content: "你是谁"},
		},
		Opts: &wshrpc.WaveAIOptsType{
			Model:         "gpt-5.4",
			ThinkingLevel: "xhigh",
			MaxTokens:     4000,
		},
	}

	body, effort := makeOpenAIResponsesRequestBody(request)
	if body.Text == nil {
		t.Fatalf("Text config = nil, want default text config")
	}
	if body.Text.Format.Type != "text" {
		t.Fatalf("Text.Format.Type = %q, want text", body.Text.Format.Type)
	}
	if body.Text.Verbosity != "medium" {
		t.Fatalf("Text.Verbosity = %q, want medium", body.Text.Verbosity)
	}
	if body.ToolChoice != "auto" {
		t.Fatalf("ToolChoice = %q, want auto", body.ToolChoice)
	}
	if effort != "xhigh" {
		t.Fatalf("effort = %q, want xhigh", effort)
	}
	if got := body.Input[1].Content[0].Type; got != "output_text" {
		t.Fatalf("assistant history content type = %q, want output_text", got)
	}
}

func collectWaveAIPackets(
	ch <-chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType],
) ([]wshrpc.WaveAIPacketType, error) {
	var packets []wshrpc.WaveAIPacketType
	for msg := range ch {
		if msg.Error != nil {
			return packets, msg.Error
		}
		packets = append(packets, msg.Response)
	}
	return packets, nil
}

func runOpenAIResponsesRequest(
	t *testing.T,
	contentType string,
	body string,
) ([]wshrpc.WaveAIPacketType, error) {
	t.Helper()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/responses" {
			t.Fatalf("path = %s, want /responses", r.URL.Path)
		}
		if accept := r.Header.Get("Accept"); !strings.Contains(accept, "application/json") || !strings.Contains(accept, "text/event-stream") {
			t.Fatalf("Accept header = %q, want both application/json and text/event-stream", accept)
		}
		requestBody, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("ReadAll(request body) error: %v", err)
		}
		var apiReq openAIResponsesRequest
		if err := json.Unmarshal(requestBody, &apiReq); err != nil {
			t.Fatalf("request body is not valid JSON: %v", err)
		}
		if apiReq.Model == "" {
			t.Fatalf("request body missing model")
		}
		if !apiReq.Stream {
			t.Fatalf("request body stream = false, want true")
		}
		if !apiReq.Store {
			t.Fatalf("request body store = false, want true")
		}

		w.Header().Set("Content-Type", contentType)
		if _, err := io.WriteString(w, body); err != nil {
			t.Fatalf("WriteString(response) error: %v", err)
		}
	}))
	defer server.Close()

	request := wshrpc.WaveAIStreamRequest{
		Prompt: []wshrpc.WaveAIPromptMessageType{
			{Role: "user", Content: "你好"},
			{Role: "assistant", Content: "你好！"},
			{Role: "user", Content: "继续"},
		},
		Opts: &wshrpc.WaveAIOptsType{
			APIType:  legacyCompatAPITypeOpenAIResponses,
			APIToken: "test-token",
			BaseURL:  server.URL,
			Model:    "gpt-5.4",
		},
	}

	return collectWaveAIPackets(OpenAIBackend{}.StreamCompletion(context.Background(), request))
}

func makeResponsesSSEEvent(t *testing.T, eventName string, payload any) string {
	t.Helper()
	if payload == nil {
		return fmt.Sprintf("event: %s\n\n", eventName)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal(%s) error: %v", eventName, err)
	}
	return fmt.Sprintf("event: %s\ndata: %s\n\n", eventName, raw)
}

func TestOpenAIResponsesPreviousResponseIDUsesBlockScopedKey(t *testing.T) {
	clientID := t.Name()
	blockA := "block-a"
	blockB := "block-b"
	scopeA := openAIResponsesScopeKey{ClientID: clientID, BlockID: blockA}
	scopeB := openAIResponsesScopeKey{ClientID: clientID, BlockID: blockB}
	openAIResponsesPreviousResponseIDs.Delete(scopeA)
	openAIResponsesPreviousResponseIDs.Delete(scopeB)
	defer openAIResponsesPreviousResponseIDs.Delete(scopeA)
	defer openAIResponsesPreviousResponseIDs.Delete(scopeB)

	requestA := wshrpc.WaveAIStreamRequest{
		ClientId: clientID,
		BlockId:  blockA,
		Prompt: []wshrpc.WaveAIPromptMessageType{
			{Role: "user", Content: "第一句"},
			{Role: "assistant", Content: "第一句答复"},
			{Role: "user", Content: "第二句"},
		},
	}
	requestB := wshrpc.WaveAIStreamRequest{
		ClientId: clientID,
		BlockId:  blockB,
		Prompt: []wshrpc.WaveAIPromptMessageType{
			{Role: "user", Content: "并行问题"},
			{Role: "assistant", Content: "并行答复"},
			{Role: "user", Content: "继续"},
		},
	}

	rememberOpenAIResponsesPreviousResponseID(requestA, "resp-a")
	rememberOpenAIResponsesPreviousResponseID(requestB, "resp-b")

	if got := getOpenAIResponsesPreviousResponseID(requestA); got != "resp-a" {
		t.Fatalf("block A previous_response_id = %q, want resp-a", got)
	}
	if got := getOpenAIResponsesPreviousResponseID(requestB); got != "resp-b" {
		t.Fatalf("block B previous_response_id = %q, want resp-b", got)
	}

	requestWithoutBlockID := requestA
	requestWithoutBlockID.BlockId = ""
	if got := getOpenAIResponsesPreviousResponseID(requestWithoutBlockID); got != "" {
		t.Fatalf("request without blockid previous_response_id = %q, want empty", got)
	}

	resetA := wshrpc.WaveAIStreamRequest{
		ClientId: clientID,
		BlockId:  blockA,
		Prompt: []wshrpc.WaveAIPromptMessageType{
			{Role: "user", Content: "重新开始"},
		},
	}
	if got := getOpenAIResponsesPreviousResponseID(resetA); got != "" {
		t.Fatalf("reset block A previous_response_id = %q, want empty", got)
	}
	if got := getOpenAIResponsesPreviousResponseID(requestB); got != "resp-b" {
		t.Fatalf("block B previous_response_id after block A reset = %q, want resp-b", got)
	}
}

func TestOpenAIResponsesHTTPClientDisablesHTTP2AndKeepsProxy(t *testing.T) {
	client, err := newOpenAIResponsesHTTPClient("http://127.0.0.1:8080")
	if err != nil {
		t.Fatalf("newOpenAIResponsesHTTPClient returned error: %v", err)
	}
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("client transport type = %T, want *http.Transport", client.Transport)
	}
	if transport.ForceAttemptHTTP2 {
		t.Fatalf("ForceAttemptHTTP2 = true, want false")
	}
	if transport.Protocols == nil || !transport.Protocols.HTTP1() {
		t.Fatalf("transport.Protocols = %#v, want HTTP/1 enabled", transport.Protocols)
	}
	if transport.Protocols.HTTP2() {
		t.Fatalf("transport.Protocols unexpectedly allows HTTP/2")
	}
	if len(transport.TLSNextProto) != 0 {
		t.Fatalf("TLSNextProto len = %d, want 0", len(transport.TLSNextProto))
	}
	req, err := http.NewRequest(http.MethodGet, "https://example.com", nil)
	if err != nil {
		t.Fatalf("http.NewRequest returned error: %v", err)
	}
	proxyURL, err := transport.Proxy(req)
	if err != nil {
		t.Fatalf("transport.Proxy returned error: %v", err)
	}
	if proxyURL == nil || proxyURL.String() != "http://127.0.0.1:8080" {
		t.Fatalf("transport.Proxy = %v, want http://127.0.0.1:8080", proxyURL)
	}
}

func TestOpenAIResponsesStreamCompletionChainsPreviousResponseIDByBlock(t *testing.T) {
	clientID := t.Name()
	blockID := "block-main"
	scopeKey := openAIResponsesScopeKey{ClientID: clientID, BlockID: blockID}
	openAIResponsesPreviousResponseIDs.Delete(scopeKey)
	defer openAIResponsesPreviousResponseIDs.Delete(scopeKey)

	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++

		requestBody, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("ReadAll(request body) error: %v", err)
		}

		var apiReq openAIResponsesRequest
		if err := json.Unmarshal(requestBody, &apiReq); err != nil {
			t.Fatalf("request body is not valid JSON: %v", err)
		}

		switch requestCount {
		case 1:
			if apiReq.PreviousResponseID != "" {
				t.Fatalf("first request previous_response_id = %q, want empty", apiReq.PreviousResponseID)
			}
			if len(apiReq.Input) != 1 || apiReq.Input[0].Role != "user" || apiReq.Input[0].Content[0].Text != "第一句" {
				t.Fatalf("first request input = %+v, want only first user turn", apiReq.Input)
			}
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(openAIResponsesResponse{
				ID:        "resp_first",
				Model:     "gpt-5.4",
				CreatedAt: 1712360001,
				Status:    "completed",
				Output: []openAIResponsesOutputItem{
					{
						Type: "message",
						Role: "assistant",
						Content: []openAIResponsesOutputContent{
							{Type: "output_text", Text: "第一句答复"},
						},
					},
				},
			}); err != nil {
				t.Fatalf("Encode(first response) error: %v", err)
			}
		case 2:
			if apiReq.PreviousResponseID != "resp_first" {
				t.Fatalf("second request previous_response_id = %q, want %q", apiReq.PreviousResponseID, "resp_first")
			}
			if len(apiReq.Input) != 1 || apiReq.Input[0].Role != "user" || apiReq.Input[0].Content[0].Text != "第二句" {
				t.Fatalf("second request input = %+v, want only follow-up user turn", apiReq.Input)
			}
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(openAIResponsesResponse{
				ID:        "resp_second",
				Model:     "gpt-5.4",
				CreatedAt: 1712360002,
				Status:    "completed",
				Output: []openAIResponsesOutputItem{
					{
						Type: "message",
						Role: "assistant",
						Content: []openAIResponsesOutputContent{
							{Type: "output_text", Text: "第二句答复"},
						},
					},
				},
			}); err != nil {
				t.Fatalf("Encode(second response) error: %v", err)
			}
		default:
			t.Fatalf("unexpected request count %d", requestCount)
		}
	}))
	defer server.Close()

	firstRequest := wshrpc.WaveAIStreamRequest{
		ClientId: clientID,
		BlockId:  blockID,
		Prompt: []wshrpc.WaveAIPromptMessageType{
			{Role: "user", Content: "第一句"},
		},
		Opts: &wshrpc.WaveAIOptsType{
			APIType:  legacyCompatAPITypeOpenAIResponses,
			APIToken: "test-token",
			BaseURL:  server.URL,
			Model:    "gpt-5.4",
		},
	}
	firstPackets, err := collectWaveAIPackets(OpenAIBackend{}.StreamCompletion(context.Background(), firstRequest))
	if err != nil {
		t.Fatalf("first StreamCompletion returned error: %v", err)
	}
	if len(firstPackets) != 2 || firstPackets[1].Text != "第一句答复" {
		t.Fatalf("first packets = %+v, want final response text", firstPackets)
	}

	secondRequest := wshrpc.WaveAIStreamRequest{
		ClientId: clientID,
		BlockId:  blockID,
		Prompt: []wshrpc.WaveAIPromptMessageType{
			{Role: "user", Content: "第一句"},
			{Role: "assistant", Content: "第一句答复"},
			{Role: "user", Content: "第二句"},
		},
		Opts: &wshrpc.WaveAIOptsType{
			APIType:  legacyCompatAPITypeOpenAIResponses,
			APIToken: "test-token",
			BaseURL:  server.URL,
			Model:    "gpt-5.4",
		},
	}
	secondPackets, err := collectWaveAIPackets(OpenAIBackend{}.StreamCompletion(context.Background(), secondRequest))
	if err != nil {
		t.Fatalf("second StreamCompletion returned error: %v", err)
	}
	if len(secondPackets) != 2 || secondPackets[1].Text != "第二句答复" {
		t.Fatalf("second packets = %+v, want final response text", secondPackets)
	}
}

func TestOpenAIResponsesStreamCompletionParsesJSONBody(t *testing.T) {
	bodyBytes, err := json.Marshal(openAIResponsesResponse{
		ID:        "resp_json",
		Model:     "gpt-5.4",
		CreatedAt: 1712345678,
		Status:    "completed",
		Output: []openAIResponsesOutputItem{
			{
				Type: "message",
				Role: "assistant",
				Content: []openAIResponsesOutputContent{
					{Type: "output_text", Text: "json body ok"},
				},
			},
		},
		Usage: &openAIResponsesUsage{
			InputTokens:  11,
			OutputTokens: 7,
			TotalTokens:  18,
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal(response) error: %v", err)
	}

	packets, err := runOpenAIResponsesRequest(t, "application/json", string(bodyBytes))
	if err != nil {
		t.Fatalf("runOpenAIResponsesRequest returned error: %v", err)
	}
	if len(packets) != 2 {
		t.Fatalf("packet count = %d, want 2", len(packets))
	}
	if packets[0].Model != "gpt-5.4" || packets[0].Created != 1712345678 {
		t.Fatalf("header packet = %+v, want model and created populated", packets[0])
	}
	if packets[1].Text != "json body ok" {
		t.Fatalf("final text = %q, want %q", packets[1].Text, "json body ok")
	}
	if packets[1].FinishReason != "stop" {
		t.Fatalf("finish reason = %q, want stop", packets[1].FinishReason)
	}
	if packets[1].Usage == nil || packets[1].Usage.TotalTokens != 18 {
		t.Fatalf("usage = %+v, want total tokens 18", packets[1].Usage)
	}
}

func TestOpenAIResponsesStreamCompletionAggregatesSSEBody(t *testing.T) {
	var sseBody strings.Builder
	sseBody.WriteString(makeResponsesSSEEvent(t, "response.created", openAIResponsesStreamEvent{
		Type: "response.created",
		Response: &openAIResponsesResponse{
			ID:        "resp_sse",
			Model:     "gpt-5.4",
			CreatedAt: 1712349999,
		},
	}))
	sseBody.WriteString(makeResponsesSSEEvent(t, "response.output_text.delta", openAIResponsesStreamEvent{
		Type:  "response.output_text.delta",
		Delta: "hello ",
	}))
	sseBody.WriteString(makeResponsesSSEEvent(t, "response.output_text.delta", openAIResponsesStreamEvent{
		Type:  "response.output_text.delta",
		Delta: "sse",
	}))
	sseBody.WriteString(makeResponsesSSEEvent(t, "response.completed", openAIResponsesStreamEvent{
		Type: "response.completed",
		Response: &openAIResponsesResponse{
			ID:        "resp_sse",
			Model:     "gpt-5.4",
			CreatedAt: 1712349999,
			Status:    "completed",
			Output: []openAIResponsesOutputItem{
				{
					Type: "message",
					Role: "assistant",
					Content: []openAIResponsesOutputContent{
						{Type: "output_text", Text: "hello sse"},
					},
				},
			},
			Usage: &openAIResponsesUsage{
				InputTokens:  9,
				OutputTokens: 4,
				TotalTokens:  13,
			},
		},
	}))

	packets, err := runOpenAIResponsesRequest(t, "application/json", sseBody.String())
	if err != nil {
		t.Fatalf("runOpenAIResponsesRequest returned error: %v", err)
	}
	if len(packets) != 2 {
		t.Fatalf("packet count = %d, want 2", len(packets))
	}
	if packets[0].Model != "gpt-5.4" || packets[0].Created != 1712349999 {
		t.Fatalf("header packet = %+v, want model and created populated", packets[0])
	}
	if packets[1].Text != "hello sse" {
		t.Fatalf("final text = %q, want %q", packets[1].Text, "hello sse")
	}
	if packets[1].FinishReason != "stop" {
		t.Fatalf("finish reason = %q, want stop", packets[1].FinishReason)
	}
	if packets[1].Usage == nil || packets[1].Usage.TotalTokens != 13 {
		t.Fatalf("usage = %+v, want total tokens 13", packets[1].Usage)
	}
}

func TestOpenAIResponsesStreamCompletionReturnsSSEErrors(t *testing.T) {
	testCases := []struct {
		name        string
		eventName   string
		response    openAIResponsesResponse
		wantErr     string
		wantPackets int
	}{
		{
			name:      "failed",
			eventName: "response.failed",
			response: openAIResponsesResponse{
				ID:        "resp_failed",
				Model:     "gpt-5.4",
				CreatedAt: 1712350001,
				Status:    "failed",
				Error:     &openAIResponsesError{Message: "backend exploded"},
			},
			wantErr:     "openai responses API failed: backend exploded",
			wantPackets: 1,
		},
		{
			name:      "incomplete",
			eventName: "response.incomplete",
			response: openAIResponsesResponse{
				ID:        "resp_incomplete",
				Model:     "gpt-5.4",
				CreatedAt: 1712350002,
				Status:    "incomplete",
				IncompleteDetails: &openAIResponsesIncompleteDetails{
					Reason: "max_output_tokens",
				},
			},
			wantErr:     "openai responses API incomplete: max_output_tokens",
			wantPackets: 1,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			var sseBody strings.Builder
			sseBody.WriteString(makeResponsesSSEEvent(t, "response.created", openAIResponsesStreamEvent{
				Type: "response.created",
				Response: &openAIResponsesResponse{
					ID:        testCase.response.ID,
					Model:     testCase.response.Model,
					CreatedAt: testCase.response.CreatedAt,
				},
			}))
			sseBody.WriteString(makeResponsesSSEEvent(t, testCase.eventName, openAIResponsesStreamEvent{
				Type:     testCase.eventName,
				Response: &testCase.response,
			}))

			packets, err := runOpenAIResponsesRequest(t, "text/event-stream", sseBody.String())
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", testCase.wantErr)
			}
			if !strings.Contains(err.Error(), testCase.wantErr) {
				t.Fatalf("error = %q, want substring %q", err.Error(), testCase.wantErr)
			}
			if len(packets) != testCase.wantPackets {
				t.Fatalf("packet count = %d, want %d", len(packets), testCase.wantPackets)
			}
			if len(packets) > 0 && (packets[0].Model != "gpt-5.4" || packets[0].Created == 0) {
				t.Fatalf("header packet = %+v, want model and created populated", packets[0])
			}
		})
	}
}
