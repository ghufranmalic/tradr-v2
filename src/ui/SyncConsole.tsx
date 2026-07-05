"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { Check, Circle, Loader2, X, XCircle } from "lucide-react";
import { formatSyncError } from "@/src/lib/sync-steps";
import type { SyncProgressState, SyncStep } from "@/src/lib/sync-steps";

type SyncConsoleProps = {
  progress: SyncProgressState;
  open: boolean;
  onClose: () => void;
};

function StepIcon({ status }: { status: SyncStep["status"] }) {
  if (status === "running") return <Loader2 size={13} className="spin sync-console-icon" />;
  if (status === "done") return <Check size={13} className="sync-console-icon sync-console-icon-done" />;
  if (status === "error") return <XCircle size={13} className="sync-console-icon sync-console-icon-error" />;
  return <Circle size={13} className="sync-console-icon sync-console-icon-pending" />;
}

export default function SyncConsole({ progress, open, onClose }: SyncConsoleProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  const finished = !progress.active && progress.finishedAt && progress.steps.length > 0;
  const failed = Boolean(progress.error);
  const doneCount = progress.steps.filter((step) => step.status === "done").length;
  const totalCount = progress.steps.length;
  const runningStep = progress.steps.find((step) => step.status === "running");

  const title = progress.active
    ? "Syncing KTrade"
    : failed
      ? "Sync failed"
      : finished
        ? "Sync complete"
        : "Starting sync";

  const panel = (
    <div className="sync-console" role="status" aria-live="polite" aria-label="Sync progress">
      <div className="sync-console-header">
        <div>
          <strong>{title}</strong>
          <span className="sync-console-sub">
            {progress.active
              ? totalCount > 0
                ? runningStep
                  ? `${runningStep.label} · step ${doneCount + 1} of ${totalCount}`
                  : `Step ${Math.min(doneCount + 1, totalCount)} of ${totalCount} · app stays usable`
                : "Starting… · app stays usable"
              : failed
                ? "Fix the issue below, then sync again"
                : finished
                  ? "Dashboard updated"
                  : "Waiting for sync to start…"}
          </span>
        </div>
        <button className="sync-console-close" onClick={onClose} type="button" aria-label="Close sync console">
          <X size={14} />
        </button>
      </div>
      <div className="sync-console-body">
        {progress.steps.length === 0 ? (
          <p className="sync-console-empty">Preparing sync…</p>
        ) : (
          <ul className="sync-console-steps">
            {progress.steps.map((step) => (
              <li key={step.id} className={`sync-console-step sync-console-step-${step.status}`}>
                <StepIcon status={step.status} />
                <div className="sync-console-step-text">
                  <span>{step.label}</span>
                  {step.detail ? <small>{step.detail}</small> : null}
                  {step.status === "pending" ? <small className="sync-console-waiting">Waiting…</small> : null}
                  {step.status === "running" ? <small className="sync-console-active">In progress…</small> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {failed ? <p className="sync-console-error">{formatSyncError(progress.error ?? "")}</p> : null}
        {finished && !failed ? <p className="sync-console-done">All steps completed.</p> : null}
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
