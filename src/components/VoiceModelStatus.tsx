import { useI18n } from "../i18n";
import { prepareVoiceModel, type VoiceModelStatus as Status } from "../localTranscription";

type Props = { status: Status; compact?: boolean };

function formatBytes(value: number): string {
  if (!value) return "";
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function VoiceModelStatus({ status, compact = false }: Props) {
  const { messages } = useI18n();
  if (status.phase === "idle") {
    return <div className="voice-model-status idle">
      <button className="secondary-button" onClick={prepareVoiceModel}>{messages.voiceModel.download}</button>
      {!compact && <small>{messages.voiceModel.size}</small>}
    </div>;
  }
  if (status.phase === "ready") {
    return <div className="voice-model-status ready" role="status"><strong>{compact ? (status.offlineReady ? messages.voiceModel.readyShort : messages.voiceModel.sessionReady) : messages.voiceModel.ready}</strong></div>;
  }
  if (status.phase === "transcribing") {
    return <div className="voice-model-status active" role="status"><strong>{messages.voiceModel.transcribing}</strong></div>;
  }
  if (status.phase === "error") {
    return <div className="voice-model-status error" role="alert" data-error={status.error}>
      <strong>{messages.voiceModel.error}</strong>
      <button className="text-action" onClick={prepareVoiceModel}>{messages.voiceModel.retry}</button>
    </div>;
  }

  const initializing = status.phase === "initializing";
  const downloaded = formatBytes(status.loaded);
  const total = formatBytes(status.total);
  return <div className="voice-model-status downloading" role="status">
    <div><strong>{initializing ? messages.voiceModel.initializing : status.progress > 0 ? messages.voiceModel.downloading : messages.voiceModel.preparing}</strong>{downloaded && !initializing && <span>{downloaded}{total ? ` / ${total}` : ""}</span>}</div>
    <progress max="100" value={status.progress} aria-label={messages.voiceModel.downloading} />
    {!compact && <small>{messages.voiceModel.size}</small>}
  </div>;
}
