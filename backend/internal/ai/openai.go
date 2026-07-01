package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// OpenAI calls the Chat Completions API with JSON-object response format.
type OpenAI struct {
	apiKey string
	model  string
}

func (o *OpenAI) Name() string  { return "openai" }
func (o *OpenAI) Model() string { return o.model }

func (o *OpenAI) Moderate(ctx context.Context, in Input) (Result, error) {
	reqBody := map[string]any{
		"model":       o.model,
		"temperature": 0.2,
		"response_format": map[string]string{
			"type": "json_object",
		},
		"messages": []map[string]string{
			{"role": "system", "content": in.SystemPrompt},
			{"role": "user", "content": buildUserPrompt(in)},
		},
	}
	b, _ := json.Marshal(reqBody)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.openai.com/v1/chat/completions", bytes.NewReader(b))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+o.apiKey)
	hc := &http.Client{Timeout: 45 * time.Second}
	resp, err := hc.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return Result{}, fmt.Errorf("openai %s: %.300s", resp.Status, string(raw))
	}

	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
			TotalTokens      int `json:"total_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return Result{}, fmt.Errorf("openai decode: %w", err)
	}
	if len(out.Choices) == 0 {
		return Result{}, fmt.Errorf("openai empty response")
	}
	res, err := parseResult(out.Choices[0].Message.Content)
	res.PromptTokens = out.Usage.PromptTokens
	res.CompletionTokens = out.Usage.CompletionTokens
	res.TotalTokens = out.Usage.TotalTokens
	return res, err
}
