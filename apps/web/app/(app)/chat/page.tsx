'use client';
import type { ChatMessage, PendingAction } from '@weight-ai/contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ErrorState, Loading } from '@/components/Shell';
import { api, ApiError, errorText } from '@/lib/api';
import { useLoad } from '@/lib/hooks';

const WRITE_TOOLS = new Set([
  'add_weight_entry',
  'update_weight_entry',
  'delete_weight_entry',
  'manage_goal',
  'update_agent_memory',
]);
const SUGGEST = [
  'Сегодня 78,4',
  'Сколько осталось до цели?',
  'Отчёт за неделю',
  'Покажи последние записи',
  'Удали последнюю запись',
  'Запомни: я взвешиваюсь после пробежки',
];
const CONV_KEY = 'weight-ai.conversation';

interface Failed {
  text: string;
  clientMessageId: string;
  error: string;
  retryable: boolean;
}

export default function ChatPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const [aiOff, setAiOff] = useState(false);
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);

  // Restore the latest conversation.
  const load = useLoad(async () => {
    const list = await api.conversations();
    let id: string | null = null;
    try {
      id = localStorage.getItem(CONV_KEY);
    } catch {
      id = null;
    }
    const target = list.items.find((c) => c.id === id) ?? list.items[0];
    if (!target) return true;
    const c = await api.conversation(target.id);
    setConversationId(c.id);
    setMessages(c.messages);
    setPending(
      c.pendingAction && new Date(c.pendingAction.expiresAt) > new Date() ? c.pendingAction : null,
    );
    return true;
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages, sending, failed]);

  async function send(text: string, clientMessageId: string = crypto.randomUUID()) {
    const t = text.trim();
    if (!t || sending) return;
    setFailed(null);
    setSending(t);
    setDraft('');
    try {
      const r = await api.chat({
        message: t,
        clientMessageId,
        ...(conversationId ? { conversationId } : {}),
      });
      setConversationId(r.conversationId);
      try {
        localStorage.setItem(CONV_KEY, r.conversationId);
      } catch {
        /* remembered for this visit only */
      }
      const userMsg: ChatMessage = {
        id: r.userMessageId,
        role: 'user',
        content: t,
        toolEvents: null,
        createdAt: r.reply.createdAt,
      };
      setMessages((m) => [...m.filter((x) => x.id !== r.userMessageId), userMsg, r.reply]);
      setPending(r.pendingAction);
      setAiOff(false);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'INTERNAL';
      if (code === 'AI_NOT_CONFIGURED') setAiOff(true);
      setFailed({
        text: t,
        clientMessageId,
        error: errorText(e),
        retryable: code !== 'AI_NOT_CONFIGURED' && code !== 'AI_BUDGET_EXCEEDED',
      });
    } finally {
      setSending(null);
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void send(draft);
  }

  function newChat() {
    setConversationId(null);
    setMessages([]);
    setPending(null);
    setFailed(null);
    try {
      localStorage.removeItem(CONV_KEY);
    } catch {
      /* nothing stored */
    }
  }

  return (
    <div className="page chat" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <span className="label">AI-помощник</span>
          <h1>Чат</h1>
        </div>
        <button className="btn sm" onClick={newChat} disabled={!conversationId && !messages.length}>
          Новый диалог
        </button>
      </div>
      {aiOff && (
        <div className="alert warn" role="status">
          AI-помощник ещё не подключён на сервере. Дневник, графики и статистика работают как
          обычно.
        </div>
      )}
      {load.error && <ErrorState text={load.error} retry={() => void load.reload()} />}
      {load.loading && !load.data ? (
        <Loading lines={3} />
      ) : (
        <div className="msgs" aria-live="polite">
          {!messages.length && !sending && (
            <div className="msg bot">
              <div className="bubble">
                Напишите вес обычными словами — «сегодня 78,4» или «вчера было 79,1». Спросите про
                прогресс, попросите отчёт или исправить запись.
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role === 'user' ? 'user' : 'bot'}`}>
              {m.toolEvents && m.toolEvents.length > 0 && (
                <div className="tools" aria-label="Вызванные инструменты">
                  {m.toolEvents.map((t, i) => (
                    <span
                      key={i}
                      className={`tool${WRITE_TOOLS.has(t.name) && t.ok ? ' write' : ''}`}
                      title={t.outcome}
                    >
                      {t.name}
                      {t.ok ? '' : ' ✕'}
                    </span>
                  ))}
                </div>
              )}
              <div className="bubble">{m.content}</div>
            </div>
          ))}
          {sending && (
            <>
              <div className="msg user">
                <div className="bubble">{sending}</div>
              </div>
              <div className="typing">Помощник отвечает…</div>
            </>
          )}
          {failed && (
            <div className="msg user">
              <div className="bubble" style={{ opacity: 0.6 }}>
                {failed.text}
              </div>
              <div className="alert" role="alert">
                <span>{failed.error}</span>
                {failed.retryable && (
                  <button
                    className="btn sm"
                    onClick={() => void send(failed.text, failed.clientMessageId)}
                  >
                    Повторить
                  </button>
                )}
              </div>
            </div>
          )}
          {pending && !sending && (
            <div className="card pending" role="alertdialog" aria-label="Подтверждение удаления">
              <span>Удалить запись {pending.description}?</span>
              <div className="row">
                <button className="btn sm danger solid" onClick={() => void send('Да, удаляй')}>
                  Да, удалить
                </button>
                <button className="btn sm" onClick={() => void send('Нет, не удаляй')}>
                  Отмена
                </button>
              </div>
            </div>
          )}
          <div ref={end} />
        </div>
      )}
      <div className="composer">
        <div className="suggest">
          {SUGGEST.map((s) => (
            <button
              key={s}
              className="btn sm"
              onClick={() => void send(s)}
              disabled={Boolean(sending)}
            >
              {s}
            </button>
          ))}
        </div>
        <form onSubmit={submit}>
          <input
            className="input"
            id="chat-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
            placeholder="Например: сегодня 78,4"
            maxLength={4000}
            aria-label="Сообщение помощнику"
          />
          <button
            className="btn primary"
            type="submit"
            disabled={Boolean(sending) || !draft.trim()}
          >
            Отправить
          </button>
        </form>
      </div>
    </div>
  );
}
