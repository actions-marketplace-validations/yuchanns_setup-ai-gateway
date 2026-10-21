# setup-ai-gateway

Run a GGUF model through llama.cpp and Magpie on a Linux runner with Docker Compose.
The Action exports the gateway URL and API key and removes its containers
and volume when the job finishes.

```yaml
steps:
  - uses: yuchanns/setup-ai-gateway@main
    id: gateway
  - run: |
      curl --fail "$AI_GATEWAY_BASE_URL/v1/responses" \
        -H "Authorization: Bearer $AI_API_KEY" \
        -H 'Content-Type: application/json' \
        -d "{\"model\":\"${{ steps.gateway.outputs.model }}\",\"input\":\"Say hello.\"}"
```

Later steps receive `AI_GATEWAY_BASE_URL` (default `http://127.0.0.1:3425`,
without `/v1`) and `AI_API_KEY`. [Magpie](https://github.com/yetone/magpie#how-it-fits-together)
provides OpenAI Chat Completions, OpenAI Responses, Anthropic Messages and Gemini APIs.

| Input | Description | Default |
| --- | --- | --- |
| `model` | Hugging Face repository containing the GGUF model. | `unsloth/Qwen3.5-4B-GGUF` |
| `model-file` | Path to the GGUF file within that repository. | `Qwen3.5-4B-Q4_K_M.gguf` |
| `port` | Gateway TCP port on the runner's loopback interface. | `3425` |
| `threads` | Number of CPU threads used for model inference. | `4` |
| `context-size` | Context window in tokens, including the prompt and generated text. | `32768` |

Outputs: `base-url`, `api-key`, `model`.
