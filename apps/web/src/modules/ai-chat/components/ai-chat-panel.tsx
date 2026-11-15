// Ask ERP panel (ADR-293): header (Model picker, ×), the help line for the picked
// model, the conversation, and the composer. Read only — the server never changes
// ERP data. One save key per panel, renewed for every new question (ADR-172).

import {
  AI_CHAT_QUESTION_MAX,
  type AiChatModel,
  type AiChatResponse,
  aiChatModelSchema,
} from '@innovic/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { fmtTime } from '@/lib/date';
import { useSaveKey } from '@/lib/use-save-key';
import { Button, Icon } from '@/ui/core';
import { Banner, FloatingPanel } from '@/ui/feedback';
import { Select } from '@/ui/forms';
import { useAiChatUsage, useAskAiChat } from '../api';
import { addFiles, type PickedFile, rejectText } from '../lib/attachments';
import {
  buildHistory,
  type ChatExchange,
  type ChatReply,
  MODEL_HELP,
  MODEL_OPTIONS,
} from '../lib/chat-types';
import { useSpeechInput } from '../lib/use-speech-input';
import { AnswerView } from './answer-view';
import { ChatComposer } from './chat-composer';

const EXAMPLES = [
  'Which POs are still open for <vendor>?',
  'Stock of <item code>?',
  'Open job cards due this week',
];

/** These answers leave the question in the box so it can be sent again. */
const KEEP_QUESTION: ReadonlySet<AiChatResponse['outcome']> = new Set(['error', 'no_credit']);

const MUTED: React.CSSProperties = { fontSize: 'var(--fs-xs)' };

function metaLine(r: Extract<ChatReply, { kind: 'answer' }>): string {
  const parts: string[] = [];
  const p = r.res.providerUsed;
  if (p)
    parts.push(`${p === 'claude' ? 'Claude' : 'Gemini'}${r.picked === 'auto' ? ' (Auto)' : ''}`);
  if (r.res.lookedUp.length > 0) parts.push(`looked up: ${r.res.lookedUp.join(', ')}`);
  parts.push(fmtTime(r.at));
  return parts.join(' · ');
}

function Reply({ reply }: { reply: ChatReply }): React.JSX.Element {
  if (reply.kind === 'failed')
    return (
      <Banner tone="error" flush role="alert">
        {reply.message}
      </Banner>
    );
  const { res } = reply;
  const banner =
    res.outcome === 'no_credit' || res.outcome === 'error'
      ? 'error'
      : res.outcome === 'limit'
        ? 'warn'
        : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
      {res.notice ? (
        <Banner tone="warn" flush>
          {res.notice}
        </Banner>
      ) : null}
      {banner ? (
        <Banner tone={banner} flush>
          {res.answer}
        </Banner>
      ) : (
        <AnswerView answer={res.answer} />
      )}
      <div className="text3" style={MUTED}>
        {metaLine(reply)}
      </div>
    </div>
  );
}

export interface AiChatPanelProps {
  model: AiChatModel;
  onModel: (m: AiChatModel) => void;
  exchanges: ChatExchange[];
  setExchanges: React.Dispatch<React.SetStateAction<ChatExchange[]>>;
  onClose: () => void;
}

export function AiChatPanel(p: AiChatPanelProps): React.JSX.Element {
  const { exchanges, setExchanges, model } = p;
  const saveKey = useSaveKey();
  const ask = useAskAiChat(saveKey);
  const usage = useAiChatUsage(true);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [limitHit, setLimitHit] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const lastAsked = useRef('');
  const appendWords = useCallback(
    (words: string) =>
      setDraft((d) =>
        (d.trim() ? `${d.trimEnd()} ${words}` : words).slice(0, AI_CHAT_QUESTION_MAX),
      ),
    [],
  );
  const speech = useSpeechInput(appendWords);

  const pending = exchanges.some((e) => e.reply === null);
  const u = usage.data;
  const locked = limitHit || (u ? u.usedToday >= u.dailyLimit : false);

  // Keep the newest line in view.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [exchanges]);

  const onAddFiles = (picked: File[]): void => {
    void addFiles(files, picked).then(({ next, rejected }) => {
      setFiles(next);
      if (rejected.length > 0) setNotices((n) => [...n, ...rejected.map(rejectText)]);
    });
  };

  const settle = (id: string, reply: ChatReply): void =>
    setExchanges((list) => list.map((e) => (e.id === id ? { ...e, reply } : e)));

  const send = (): void => {
    const question = draft.trim();
    if (sendingRef.current || pending || locked || speech.listening) return;
    if (!question && files.length === 0) return;
    sendingRef.current = true;
    const sent = files;
    // A different question is a new save; the same one resent after a timeout
    // carries the same key, so the server answers it once.
    const signature = `${model}|${question}|${sent.map((f) => `${f.name}:${f.size}`).join(',')}`;
    if (signature !== lastAsked.current) saveKey.rotate();
    lastAsked.current = signature;
    const id = `${Date.now()}`;
    const history = buildHistory(exchanges);
    const restore = (): void => {
      setDraft((d) => d || question);
      setFiles((f) => (f.length > 0 ? f : sent));
    };
    setExchanges((list) => [
      ...list,
      { id, question, fileNames: sent.map((f) => f.name), reply: null },
    ]);
    setDraft('');
    setFiles([]);
    setNotices([]);
    ask
      .mutateAsync({
        model,
        question,
        history,
        files: sent.map(({ name, type, data }) => ({ name, type, data })),
      })
      .then((res) => {
        settle(id, { kind: 'answer', res, picked: model, at: Date.now() });
        if (res.outcome === 'limit') setLimitHit(true);
        if (KEEP_QUESTION.has(res.outcome)) restore();
      })
      .catch((err: unknown) => {
        const message =
          err instanceof ApiError || err instanceof Error
            ? err.message
            : 'The question could not be sent. Please try again.';
        settle(id, { kind: 'failed', message });
        restore();
      })
      .finally(() => {
        sendingRef.current = false;
      });
  };

  const usageText = `${u ? `${u.usedToday} of ${u.dailyLimit} today · ` : ''}up to 3 files: images 3.5 MB, PDF 5 MB`;
  const speechNotice = speech.problem ? [speech.problem] : [];

  return (
    <FloatingPanel
      title="Ask ERP"
      subtitle="Live ERP data · read only · nothing is changed"
      onClose={p.onClose}
      confirmExit={draft.trim() !== '' || files.length > 0}
      bodyRef={bodyRef}
      headerActions={
        <>
          <label className="text3" style={MUTED} htmlFor="ai-chat-model">
            Model
          </label>
          <Select
            id="ai-chat-model"
            fieldWidth="sm"
            options={MODEL_OPTIONS}
            value={model}
            onChange={(e) => {
              const picked = aiChatModelSchema.safeParse(e.target.value);
              if (picked.success) p.onModel(picked.data);
            }}
          />
        </>
      }
      subheader={
        <div
          className="text3"
          style={{
            ...MUTED,
            padding: 'var(--sp-1) var(--sp-4)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {MODEL_HELP[model]}
        </div>
      }
      footer={
        <ChatComposer
          draft={draft}
          onDraft={setDraft}
          files={files}
          onAddFiles={onAddFiles}
          onRemoveFile={(fid) => setFiles((f) => f.filter((x) => x.id !== fid))}
          notices={[...notices, ...speechNotice]}
          onDismissNotices={() => {
            setNotices([]);
            speech.clearProblem();
          }}
          speech={speech}
          pending={pending}
          locked={locked}
          usageText={usageText}
          onSend={send}
        />
      }
    >
      {exchanges.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          <div className="text3" style={{ fontSize: 'var(--fs-sm)' }}>
            Ask about orders, stock, job cards, purchase or quality. For example:
          </div>
          {EXAMPLES.map((q) => (
            <div key={q}>
              <Button variant="ghost" size="sm" onClick={() => setDraft(q)}>
                {q}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          {exchanges.map((e) => (
            <div
              key={e.id}
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}
            >
              <div
                style={{
                  alignSelf: 'flex-end',
                  maxWidth: '85%',
                  background: 'var(--accent-wash)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius2)',
                  padding: 'var(--sp-2) var(--sp-3)',
                  fontSize: 'var(--fs-sm)',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}
              >
                {e.question}
                {e.fileNames.length > 0 ? (
                  <div className="text3" style={MUTED}>
                    Attached: {e.fileNames.join(', ')}
                  </div>
                ) : null}
              </div>
              {e.reply ? (
                <Reply reply={e.reply} />
              ) : (
                <div className="text3" style={{ ...MUTED, display: 'flex', gap: 'var(--sp-1)' }}>
                  <Icon name="loader-2" size={12} className="spin" />
                  Looking it up in the ERP…
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </FloatingPanel>
  );
}
