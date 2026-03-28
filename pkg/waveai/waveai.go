// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"context"
	"errors"
	"log"
	"net/url"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const WaveAIPacketstr = "waveai"
const APIType_Anthropic = "anthropic"
const APIType_Perplexity = "perplexity"
const APIType_Google = "google"
const APIType_OpenAI = "openai"

type WaveAICmdInfoPacketOutputType struct {
	Model        string `json:"model,omitempty"`
	Created      int64  `json:"created,omitempty"`
	FinishReason string `json:"finish_reason,omitempty"`
	Message      string `json:"message,omitempty"`
	Error        string `json:"error,omitempty"`
}

func MakeWaveAIPacket() *wshrpc.WaveAIPacketType {
	return &wshrpc.WaveAIPacketType{Type: WaveAIPacketstr}
}

type WaveAICmdInfoChatMessage struct {
	MessageID           int                            `json:"messageid"`
	IsAssistantResponse bool                           `json:"isassistantresponse,omitempty"`
	AssistantResponse   *WaveAICmdInfoPacketOutputType `json:"assistantresponse,omitempty"`
	UserQuery           string                         `json:"userquery,omitempty"`
	UserEngineeredQuery string                         `json:"userengineeredquery,omitempty"`
}

type AIBackend interface {
	StreamCompletion(
		ctx context.Context,
		request wshrpc.WaveAIStreamRequest,
	) chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]
}

func IsCloudAIRequest(opts *wshrpc.WaveAIOptsType) bool {
	if opts == nil {
		return true
	}
	return opts.BaseURL == "" && opts.APIToken == ""
}

func isLocalURL(baseURL string) bool {
	if baseURL == "" {
		return false
	}

	u, err := url.Parse(baseURL)
	if err != nil {
		return false
	}

	host := strings.ToLower(u.Hostname())
	return host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0" || strings.HasPrefix(host, "192.168.") || strings.HasPrefix(host, "10.") || (strings.HasPrefix(host, "172.") && len(host) > 4)
}

func makeAIError(err error) wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType] {
	return wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Error: err}
}

func RunAICommand(ctx context.Context, request wshrpc.WaveAIStreamRequest) chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType] {
	telemetry.GoUpdateActivityWrap(wshrpc.ActivityUpdate{NumAIReqs: 1}, "RunAICommand")
	if request.Opts == nil {
		err := errors.New("no wave ai opts found")
		log.Printf("RunAICommand error: %v\n", err)
		rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType], 1)
		rtn <- makeAIError(err)
		close(rtn)
		return rtn
	}

	originalOpts := *request.Opts
	if nextRequest, override, err := maybeApplyCodexProviderOverride(request); err != nil {
		log.Printf("codex provider override unavailable: %v\n", err)
	} else if override != nil {
		request = nextRequest
		log.Printf(
			"applied codex provider override provider=%q model=%q->%q thinking=%q->%q apitype=%q->%q baseurl=%q->%q auth_override=%t\n",
			override.ProviderName,
			originalOpts.Model,
			request.Opts.Model,
			originalOpts.ThinkingLevel,
			request.Opts.ThinkingLevel,
			originalOpts.APIType,
			request.Opts.APIType,
			originalOpts.BaseURL,
			request.Opts.BaseURL,
			override.APIToken != "",
		)
	}

	endpoint := request.Opts.BaseURL
	if endpoint == "" {
		endpoint = "default"
	}
	var backend AIBackend
	var backendType string
	if request.Opts.APIType == APIType_Anthropic {
		backend = AnthropicBackend{}
		backendType = APIType_Anthropic
	} else if request.Opts.APIType == APIType_Perplexity {
		backend = PerplexityBackend{}
		backendType = APIType_Perplexity
	} else if request.Opts.APIType == APIType_Google {
		backend = GoogleBackend{}
		backendType = APIType_Google
	} else if IsCloudAIRequest(request.Opts) {
		endpoint = "waveterm cloud"
		request.Opts.APIType = APIType_OpenAI
		if request.Opts.Model == "" {
			request.Opts.Model = "default"
		}
		backend = WaveAICloudBackend{}
		backendType = "wave"
	} else {
		backend = OpenAIBackend{}
		backendType = APIType_OpenAI
	}
	if backend == nil {
		log.Printf("no backend found for %s\n", request.Opts.APIType)
		return nil
	}
	aiLocal := backendType != "wave" && isLocalURL(request.Opts.BaseURL)
	telemetry.GoRecordTEventWrap(&telemetrydata.TEvent{
		Event: "action:runaicmd",
		Props: telemetrydata.TEventProps{
			AiBackendType: backendType,
			AiLocal:       aiLocal,
		},
	})

	log.Printf(
		"sending ai chat message to %s endpoint %q using model %s thinking=%q\n",
		request.Opts.APIType,
		endpoint,
		request.Opts.Model,
		request.Opts.ThinkingLevel,
	)
	return backend.StreamCompletion(ctx, request)
}
