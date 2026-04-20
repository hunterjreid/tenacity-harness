export async function callOllama({ url, model, prompt }) {
  const res = await fetch(`${url}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama ${res.status}: ${body || res.statusText}`);
  }

  const data = await res.json();
  return (data.response || '').trim();
}
