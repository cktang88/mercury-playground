const output = document.getElementById('chat-output');
const input = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const tempSlider = document.getElementById('temperature');
const tempValue = document.getElementById('temp-value');
const statusDot = document.querySelector('.status-dot');
const statusText = document.querySelector('.status-text');
const connectionStatus = document.getElementById('connection-status');

let messageHistory = [];
let inputTokens = 0;
let outputTokens = 0;
let isStreaming = false;

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  sendBtn.disabled = input.value.trim() === '' || isStreaming;
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

tempSlider.addEventListener('input', () => {
  tempValue.textContent = tempSlider.value;
});

async function checkStatus() {
  try {
    const res = await fetch('/api/health');
    if (res.ok) {
      const data = await res.json();
      statusDot.classList.add('connected');
      statusText.textContent = data.modelsAvailable ? 'API ready' : 'Checking API...';
      connectionStatus.textContent = 'Connected';
      modeText.textContent = data.apiKeyConfigured ? '🟢 API Configured' : '⚠️ No API Key';
    } else {
      throw new Error('Not ok');
    }
  } catch {
    statusDot.classList.add('error');
    statusText.textContent = 'Not responding';
    connectionStatus.textContent = 'Not responding';
    modeText.textContent = '';
  }
}

checkStatus();
setInterval(checkStatus, 30000);

async function sendMessage() {
  const text = input.value.trim();
  if (!text || isStreaming) return;

  isStreaming = true;
  sendBtn.disabled = true;
  input.value = '';
  input.style.height = 'auto';

  addMessage('user', text);
  messageHistory.push({ role: 'user', content: text });
  inputTokens += Math.ceil(text.length / 4);
  updateUsage();

  const assistantDiv = document.createElement('div');
  assistantDiv.className = 'message assistant';
  assistantDiv.innerHTML = `<span class="message-content"></span><span class="message-time"></span>`;
  output.appendChild(assistantDiv);
  const contentSpan = assistantDiv.querySelector('.message-content');
  const timeSpan = assistantDiv.querySelector('.message-time');
  timeSpan.textContent = new Date().toLocaleTimeString();

  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  contentSpan.appendChild(cursor);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messageHistory,
        temperature: parseFloat(tempSlider.value),
        max_tokens: parseInt(document.getElementById('max-tokens').value)
      })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              contentSpan.textContent += delta;
              output.scrollTop = output.scrollHeight;
            }
          } catch {}
        }
      }
    }

    cursor.remove();

    const responseText = contentSpan.textContent;
    messageHistory.push({ role: 'assistant', content: responseText });
    outputTokens += Math.ceil(responseText.length / 4);
    updateUsage();

  } catch (err) {
    cursor.remove();
    contentSpan.textContent += ` [Error: ${err.message}]`;
    outputTokens += 1;
    updateUsage();
  } finally {
    isStreaming = false;
    sendBtn.disabled = input.value.trim() === '';
  }
}

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.innerHTML = `<span class="message-content">${escapeHtml(text)}</span><span class="message-time">${new Date().toLocaleTimeString()}</span>`;
  output.appendChild(div);
  output.scrollTop = output.scrollHeight;
}

function updateUsage() {
  document.getElementById('input-tokens').textContent = inputTokens;
  document.getElementById('output-tokens').textContent = outputTokens;
  document.getElementById('total-tokens').textContent = inputTokens + outputTokens;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
