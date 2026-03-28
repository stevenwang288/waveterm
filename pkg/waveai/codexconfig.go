package waveai

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type codexProviderConfig struct {
	ProviderName       string
	BaseURL            string
	RequiresOpenAIAuth bool
	WireAPI            string
}

type codexConfigSnapshot struct {
	Model                   string
	ModelReasoningEffort    string
	PlanModeReasoningEffort string
	ModelProvider           string
	Providers               map[string]codexProviderConfig
}

type codexProviderOverride struct {
	ProviderName  string
	Model         string
	ThinkingLevel string
	APIType       string
	BaseURL       string
	APIToken      string
}

type codexAuthSnapshot struct {
	OpenAIAPIKey string `json:"OPENAI_API_KEY"`
}

func getCodexHomeDir() string {
	if value := strings.TrimSpace(os.Getenv("CODEX_HOME")); value != "" {
		return value
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(homeDir, ".codex")
}

func readCodexConfigSnapshot() (*codexConfigSnapshot, error) {
	codexHome := getCodexHomeDir()
	if codexHome == "" {
		return nil, nil
	}
	content, err := os.ReadFile(filepath.Join(codexHome, "config.toml"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	return parseCodexConfigSnapshot(string(content)), nil
}

func readCodexAuthSnapshot() (*codexAuthSnapshot, error) {
	codexHome := getCodexHomeDir()
	if codexHome == "" {
		return nil, nil
	}
	content, err := os.ReadFile(filepath.Join(codexHome, "auth.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var snapshot codexAuthSnapshot
	if err := json.Unmarshal(content, &snapshot); err != nil {
		return nil, err
	}
	return &snapshot, nil
}

func parseCodexConfigSnapshot(content string) *codexConfigSnapshot {
	snapshot := &codexConfigSnapshot{
		Providers: make(map[string]codexProviderConfig),
	}
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	currentSection := ""
	activeProviderName := ""
	inMultilineString := false

	for _, rawLine := range lines {
		trimmedLine := strings.TrimSpace(rawLine)
		if strings.Count(trimmedLine, `"""`)%2 == 1 {
			inMultilineString = !inMultilineString
		}
		if inMultilineString {
			continue
		}

		line := strings.TrimSpace(stripCodexTomlComment(rawLine))
		if line == "" {
			continue
		}

		if sectionMatch := parseCodexSection(line); sectionMatch != "" {
			currentSection = sectionMatch
			activeProviderName = parseCodexProviderSectionName(currentSection)
			continue
		}

		key, rawValue, ok := parseCodexAssignment(line)
		if !ok {
			continue
		}
		switch {
		case currentSection == "" && key == "model":
			snapshot.Model = parseCodexTomlStringValue(rawValue)
		case currentSection == "" && key == "model_reasoning_effort":
			snapshot.ModelReasoningEffort = parseCodexTomlStringValue(rawValue)
		case currentSection == "" && key == "plan_mode_reasoning_effort":
			snapshot.PlanModeReasoningEffort = parseCodexTomlStringValue(rawValue)
		case currentSection == "" && (key == "model_provider" || key == "provider"):
			snapshot.ModelProvider = parseCodexTomlStringValue(rawValue)
		case activeProviderName != "":
			providerConfig := snapshot.Providers[activeProviderName]
			providerConfig.ProviderName = activeProviderName
			switch key {
			case "base_url":
				providerConfig.BaseURL = parseCodexTomlStringValue(rawValue)
			case "requires_openai_auth":
				if parsed, ok := parseCodexTomlBoolValue(rawValue); ok {
					providerConfig.RequiresOpenAIAuth = parsed
				}
			case "wire_api":
				providerConfig.WireAPI = parseCodexTomlStringValue(rawValue)
			}
			snapshot.Providers[activeProviderName] = providerConfig
		}
	}

	return snapshot
}

func maybeApplyCodexProviderOverride(request wshrpc.WaveAIStreamRequest) (wshrpc.WaveAIStreamRequest, *codexProviderOverride, error) {
	if request.Opts == nil {
		return request, nil, nil
	}

	snapshot, err := readCodexConfigSnapshot()
	if err != nil || snapshot == nil {
		return request, nil, err
	}

	authSnapshot, err := readCodexAuthSnapshot()
	if err != nil {
		return request, nil, err
	}

	override := resolveCodexProviderOverride(request.Opts, snapshot, authSnapshot)
	if override == nil {
		return request, nil, nil
	}

	nextRequest := request
	nextOpts := *request.Opts
	if override.Model != "" {
		nextOpts.Model = override.Model
	}
	if override.ThinkingLevel != "" {
		nextOpts.ThinkingLevel = override.ThinkingLevel
	}
	if override.APIType != "" {
		nextOpts.APIType = override.APIType
	}
	if override.BaseURL != "" {
		nextOpts.BaseURL = override.BaseURL
	}
	if override.APIToken != "" {
		nextOpts.APIToken = override.APIToken
	}
	nextRequest.Opts = &nextOpts
	return nextRequest, override, nil
}

func resolveCodexProviderOverride(
	opts *wshrpc.WaveAIOptsType,
	snapshot *codexConfigSnapshot,
	authSnapshot *codexAuthSnapshot,
) *codexProviderOverride {
	if opts == nil || snapshot == nil || snapshot.ModelProvider == "" {
		return nil
	}

	providerConfig, found := snapshot.Providers[snapshot.ModelProvider]
	if !found {
		return nil
	}

	requestBaseURL := canonicalizeCodexProviderBaseURL(opts.BaseURL)
	providerBaseURL := canonicalizeCodexProviderBaseURL(providerConfig.BaseURL)
	if requestBaseURL != "" && providerBaseURL != "" && requestBaseURL != providerBaseURL {
		return nil
	}

	providerAPIType := mapCodexWireAPIToWaveAPIType(providerConfig.WireAPI)
	if !codexAPITypeMatchesRequest(opts.APIType, providerAPIType) {
		return nil
	}

	override := &codexProviderOverride{
		ProviderName:  providerConfig.ProviderName,
		Model:         strings.TrimSpace(snapshot.Model),
		ThinkingLevel: firstNonBlank(snapshot.ModelReasoningEffort, snapshot.PlanModeReasoningEffort),
		APIType:       providerAPIType,
		BaseURL:       strings.TrimSpace(providerConfig.BaseURL),
	}
	if providerConfig.RequiresOpenAIAuth && authSnapshot != nil {
		override.APIToken = strings.TrimSpace(authSnapshot.OpenAIAPIKey)
	}
	if override.Model == "" && override.ThinkingLevel == "" && override.APIType == "" && override.BaseURL == "" && override.APIToken == "" {
		return nil
	}
	return override
}

func stripCodexTomlComment(line string) string {
	var builder strings.Builder
	inBasicString := false
	escaped := false
	for _, ch := range line {
		switch {
		case ch == '"' && !escaped:
			inBasicString = !inBasicString
			builder.WriteRune(ch)
			escaped = false
		case ch == '#' && !inBasicString:
			return builder.String()
		default:
			builder.WriteRune(ch)
			if ch == '\\' && inBasicString && !escaped {
				escaped = true
			} else {
				escaped = false
			}
		}
	}
	return builder.String()
}

func parseCodexSection(line string) string {
	if len(line) >= 2 && strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
		return strings.TrimSpace(line[1 : len(line)-1])
	}
	return ""
}

func parseCodexAssignment(line string) (string, string, bool) {
	parts := strings.SplitN(line, "=", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	key := strings.TrimSpace(parts[0])
	value := strings.TrimSpace(parts[1])
	if key == "" {
		return "", "", false
	}
	return key, value, true
}

func parseCodexTomlStringValue(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if len(trimmed) >= 2 {
		switch trimmed[0] {
		case '"':
			if trimmed[len(trimmed)-1] == '"' {
				if parsed, err := strconv.Unquote(trimmed); err == nil {
					return strings.TrimSpace(parsed)
				}
				return strings.TrimSpace(trimmed[1 : len(trimmed)-1])
			}
		case '\'':
			if trimmed[len(trimmed)-1] == '\'' {
				return strings.TrimSpace(trimmed[1 : len(trimmed)-1])
			}
		}
	}
	return strings.TrimSpace(trimmed)
}

func parseCodexTomlBoolValue(raw string) (bool, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "true":
		return true, true
	case "false":
		return false, true
	default:
		return false, false
	}
}

func parseCodexProviderSectionName(sectionName string) string {
	const prefix = "model_providers."
	if !strings.HasPrefix(sectionName, prefix) {
		return ""
	}
	rawProviderName := strings.TrimSpace(sectionName[len(prefix):])
	if rawProviderName == "" {
		return ""
	}
	return parseCodexTomlStringValue(rawProviderName)
}

func canonicalizeCodexProviderBaseURL(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	parsedURL, err := url.Parse(trimmed)
	if err != nil {
		return strings.TrimRight(trimmed, "/")
	}

	pathValue := strings.TrimRight(parsedURL.Path, "/")
	lowerPath := strings.ToLower(pathValue)
	switch {
	case strings.HasSuffix(lowerPath, "/v1/chat/completions"):
		pathValue = pathValue[:len(pathValue)-len("/v1/chat/completions")]
	case strings.HasSuffix(lowerPath, "/chat/completions"):
		pathValue = pathValue[:len(pathValue)-len("/chat/completions")]
	case strings.HasSuffix(lowerPath, "/v1/responses"):
		pathValue = pathValue[:len(pathValue)-len("/v1/responses")]
	case strings.HasSuffix(lowerPath, "/responses"):
		pathValue = pathValue[:len(pathValue)-len("/responses")]
	case strings.HasSuffix(lowerPath, "/v1"):
		pathValue = pathValue[:len(pathValue)-len("/v1")]
	}

	parsedURL.RawQuery = ""
	parsedURL.Fragment = ""
	if pathValue == "" || pathValue == "/" {
		parsedURL.Path = ""
	} else {
		parsedURL.Path = pathValue
	}
	return strings.TrimRight(parsedURL.String(), "/")
}

func mapCodexWireAPIToWaveAPIType(wireAPI string) string {
	switch strings.ToLower(strings.TrimSpace(wireAPI)) {
	case "responses":
		return legacyCompatAPITypeOpenAIResponses
	case "chat", "chat_completions", "chat-completions":
		return APIType_OpenAI
	default:
		return ""
	}
}

func codexAPITypeMatchesRequest(requestAPIType string, providerAPIType string) bool {
	normalizedRequestAPIType := normalizeLegacyAPIType(requestAPIType)
	normalizedProviderAPIType := normalizeLegacyAPIType(providerAPIType)
	if normalizedProviderAPIType == "" || normalizedRequestAPIType == "" {
		return true
	}
	if normalizedRequestAPIType == normalizedProviderAPIType {
		return true
	}
	return normalizedRequestAPIType == APIType_OpenAI && normalizedProviderAPIType == legacyCompatAPITypeOpenAIResponses
}

func firstNonBlank(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
