const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const chatBox = document.querySelector("#chat-box");
const sendButton = document.querySelector("#send-button");

// Riwayat percakapan yang dikirim ke server
const messages = [];
let isBusy = false;

function scrollToLatest() {
    chatBox.scrollTop = chatBox.scrollHeight;
}

function addMessage(role, text, options = {}) {
    const message = document.createElement("div");
    message.className = `message ${role}`;

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (options.pending) {
        bubble.innerHTML = '<span class="typing" aria-label="Sedang mengetik"><span></span><span></span><span></span></span>';
    } else {
        bubble.textContent = text;
    }

    message.append(bubble);
    chatBox.append(message);
    scrollToLatest();
    return bubble;
}

function setBusy(busy) {
    isBusy = busy;
    input.disabled = busy;
    sendButton.disabled = busy;
}

function showError(text, bubble) {
    bubble.classList.add("error");
    bubble.setAttribute("role", "alert");
    bubble.textContent = text;
    scrollToLatest();
}

function readStreamLine(line, bubble, state) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
        return;
    }

    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") {
        return;
    }

    let value = data;
    try {
        value = JSON.parse(data);
    } catch {
        // Jika bukan JSON, anggap sebagai teks biasa
    }

    if (typeof value === "string") {
        state.reply += value;
    } else if (value && typeof value === "object" && typeof value.error === "string") {
        state.error = value.error;
        return;
    } else if (value && typeof value === "object" && typeof value.content === "string") {
        state.reply += value.content;
    }

    if (state.reply) {
        bubble.textContent = state.reply;
        scrollToLatest();
    }
}

async function submitMessage(text) {
    const userText = text.trim();
    if (isBusy || !userText) {
        return;
    }

    addMessage("user", userText);
    messages.push({ role: "user", content: userText });

    const botBubble = addMessage("bot", "", { pending: true });
    setBusy(true);

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: messages })
        });

        if (!response.ok) {
            const details = await response.text();
            throw new Error(details || `Server merespons dengan status ${response.status}.`);
        }

        if (!response.body) {
            throw new Error("Server tidak menyediakan aliran jawaban.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const state = { reply: "", error: "" };
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || "";
            lines.forEach((line) => readStreamLine(line, botBubble, state));

            if (done) {
                if (buffer) {
                    readStreamLine(buffer, botBubble, state);
                }
                break;
            }
        }

        if (state.error) {
            throw new Error(state.error);
        }
        if (!state.reply) {
            throw new Error("Belum ada jawaban dari server. Silakan coba lagi.");
        }

        messages.push({ role: "assistant", content: state.reply });
    } catch (error) {
        console.error("Gagal mengirim pesan:", error);
        // Pesan pengguna yang gagal dihapus dari riwayat agar tidak menumpuk
        messages.pop();
        showError(error.message || "Pesan gagal dikirim. Silakan coba lagi.", botBubble);
    } finally {
        setBusy(false);
        input.focus();
    }
}

form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value;
    if (!text.trim() || isBusy) {
        return;
    }

    input.value = "";
    submitMessage(text);
});
