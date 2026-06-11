# Core Binaries

This directory holds platform-specific native binaries bundled with AinCore.

## llama-server

The `llama-server` binary (from [llama.cpp](https://github.com/ggerganov/llama.cpp)) is used for local LLM inference.

### Obtaining binaries

Download the appropriate binary for your platform from the [llama.cpp releases page](https://github.com/ggerganov/llama.cpp/releases) and place it in this directory.

| Platform | Binary name |
|----------|------------|
| macOS arm64 | `llama-server` |
| macOS x64 | `llama-server` |
| Linux x64 | `llama-server` |
| Windows x64 | `llama-server.exe` |

> **Note**: These binaries are NOT included in the Git repository due to their size. They must be downloaded separately or are bundled during the CI release build process.
