# Mercury 2.5 Playground

A full-stack playground for testing Mercury 2.5, the diffusion-based LLM from Inception.

## Features

- 🌊 **Mercury 2.5 Support** - Test the latest diffusion-based LLM
- ⚡ **Streaming Responses** - See responses in real-time
- 🔧 **Configurable Settings** - Adjust temperature, API key, and endpoint
- 📱 **Responsive UI** - Works on desktop and mobile

## Setup

1. **Install dependencies:**
   ```bash
   cd playground
   npm install
   ```

2. **Configure API access:**
   Create a `.env` file in the playground directory:
   ```env
   INCEPTION_API_KEY=your_api_key_here
   INCEPTION_API_URL=https://api.inception.ai/v1/chat/completions
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Open your browser:**
   Navigate to http://localhost:3000

## API Format

The backend accepts OpenAI-compatible requests:

```json
{
  "messages": [
    {"role": "user", "content": "Hello!"}
  ],
  "temperature": 0.7
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INCEPTION_API_KEY` | - | Your Inception API key |
| `INCEPTION_API_URL` | `https://api.inception.ai/v1/chat/completions` | API endpoint |
| `PORT` | `3000` | Server port |

## Tech Stack

- **Backend:** Node.js, Express
- **Frontend:** Vanilla HTML/CSS/JS
- **API:** OpenAI-compatible format
