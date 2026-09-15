import React from "react";
import {
  EXTRACTION_ERROR_MESSAGES,
  type ExtractionErrorCode,
  type JobItem,
} from "@youtube-transcript/core";
import { closePanel } from "../shadow-shell.js";
import { ALL_FORMATS, FORMAT_LABELS, POPULAR_LANGUAGES } from "./types.js";
import { usePanelController } from "./use-panel-controller.js";

export const App: React.FC = () => {
  const {
    viewState,
    detectedSource,
    selectedFormats,
    toggleFormat,
    includeTimestamps,
    setIncludeTimestamps,
    selectedLanguage,
    setSelectedLanguage,
    startExtraction,
    cancelExtraction,
    resumeExtraction,
    downloadExport,
    resetToConfig,
    jobState,
    errorMessage,
    enumeratedCount,
    isDownloading,
  } = usePanelController();

  const totalItems = jobState?.items.length ?? 0;
  const processedCount = jobState
    ? jobState.summary.done + jobState.summary.skipped + jobState.summary.failed
    : 0;
  const progressPercent =
    totalItems > 0
      ? Math.min(100, Math.round((processedCount / totalItems) * 100))
      : 0;

  return (
    <div className="panel-inner" data-testid="panel-app">
      {/* 1. Header Bar */}
      <header className="panel-header">
        <div className="panel-header-title">
          <svg
            className="panel-icon"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M19 4H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm-8 7H6v-2h5v2zm7 4H6v-2h12v2zm0-4h-5V9h5v2z" />
          </svg>
          <span className="panel-header-text">Bulk Transcripts</span>
        </div>
        <button
          type="button"
          className="panel-close-btn"
          aria-label="Close drawer"
          data-testid="panel-close-btn"
          onClick={() => closePanel()}
        >
          &times;
        </button>
      </header>

      {/* 2. Detected Source Card */}
      <div className="source-card" data-testid="source-card">
        <div className="source-card-header">
          <span className="source-badge">
            {detectedSource.type.toUpperCase()}
          </span>
          {detectedSource.estimatedCount !== undefined && (
            <span
              className="source-count-badge"
              data-testid="source-count-badge"
            >
              ~{detectedSource.estimatedCount} videos
            </span>
          )}
        </div>
        <h2
          className="source-title"
          data-testid="source-title"
          title={detectedSource.title}
        >
          {detectedSource.title}
        </h2>
        {detectedSource.handleOrAuthor && (
          <p className="source-handle">{detectedSource.handleOrAuthor}</p>
        )}
      </div>

      {/* Global Error Banner if present (suppressed in paused and failed views which render dedicated summary banners) */}
      {errorMessage && viewState !== "paused" && viewState !== "failed" && (
        <div className="error-banner" data-testid="error-banner" role="alert">
          <span className="error-banner-icon">&#9888;</span>
          <span className="error-banner-text">{errorMessage}</span>
        </div>
      )}

      {/* Main Content Area based on viewState */}
      <div className="panel-body">
        {/* VIEW A: Configuration Form */}
        {viewState === "config" && (
          <div className="config-form" data-testid="config-view">
            {/* Format Checkboxes */}
            <div className="form-section">
              <label className="section-label">
                Export Formats <span className="required-star">*</span>
              </label>
              <p className="section-hint">
                Select one or more formats to include in the archive.
              </p>
              <div className="formats-grid">
                {ALL_FORMATS.map((fmt) => {
                  const checked = selectedFormats.includes(fmt);
                  return (
                    <label
                      key={fmt}
                      className={`format-checkbox-label ${checked ? "checked" : ""}`}
                    >
                      <input
                        type="checkbox"
                        className="format-checkbox"
                        checked={checked}
                        data-testid={`format-checkbox-${fmt}`}
                        onChange={() => toggleFormat(fmt)}
                      />
                      <span className="format-name">{FORMAT_LABELS[fmt]}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* TXT Timestamps Toggle */}
            <div className="form-section">
              <label className="section-label">Timestamp Options</label>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  className="toggle-checkbox"
                  data-testid="timestamp-toggle"
                  checked={includeTimestamps}
                  onChange={(e) => setIncludeTimestamps(e.target.checked)}
                />
                <span className="toggle-text">
                  Include timestamps in TXT
                  <span className="toggle-subtext">
                    Prefixes paragraphs with <code>[mm:ss]</code>
                  </span>
                </span>
              </label>
            </div>

            {/* Language Selector */}
            <div className="form-section">
              <label className="section-label" htmlFor="language-select">
                Transcript Language
              </label>
              <p className="section-hint">
                Prefers this language, falling back to video default.
              </p>
              <select
                id="language-select"
                className="language-select"
                data-testid="language-select"
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
              >
                {POPULAR_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* VIEW B: Enumerating Videos */}
        {viewState === "enumerating" && (
          <div className="enumerating-view" data-testid="enumerating-view">
            <div className="spinner" aria-hidden="true" />
            <h3 className="enumerating-title">Discovering videos...</h3>
            <p
              className="enumerating-counter"
              data-testid="enumerating-counter"
            >
              Found {enumeratedCount} video{enumeratedCount === 1 ? "" : "s"}
            </p>
            <p className="enumerating-subtext">
              Traversing channel upload stream and pagination continuations.
            </p>
          </div>
        )}

        {/* VIEW C: Active Running Job */}
        {viewState === "running" && jobState && (
          <div className="active-job-view" data-testid="active-job-view">
            {/* Progress Counter & Bar */}
            <div className="progress-section">
              <div className="progress-header">
                <span
                  className="progress-counter"
                  data-testid="progress-counter"
                >
                  {processedCount} / {totalItems}
                </span>
                <span className="progress-percent">{progressPercent}%</span>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-valuenow={progressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="progress-stats">
                <span className="stat-done">
                  ✓ {jobState.summary.done} done
                </span>
                <span className="stat-skipped">
                  ⚠ {jobState.summary.skipped} skipped
                </span>
                <span className="stat-failed">
                  ✕ {jobState.summary.failed} failed
                </span>
              </div>
            </div>

            {/* Scrollable Items List */}
            <div className="items-list-container">
              <h4 className="items-list-title">Video Queue ({totalItems})</h4>
              <div className="items-scroll-list" data-testid="items-list">
                {jobState.items.map((item: JobItem, index: number) => (
                  <VideoItemRow key={item.videoId} item={item} index={index} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* VIEW D: Completed / Cancelled */}
        {(viewState === "completed" || viewState === "cancelled") &&
          jobState && (
            <div className="completion-view" data-testid="completion-view">
              <div
                className={`summary-banner ${
                  viewState === "completed"
                    ? "banner-completed"
                    : "banner-cancelled"
                }`}
                data-testid="completion-banner"
              >
                <span className="summary-banner-icon">
                  {viewState === "completed" ? "✓" : "⚠"}
                </span>
                <div className="summary-banner-content">
                  <h3 className="summary-banner-title">
                    {viewState === "completed"
                      ? "Extraction Complete"
                      : "Extraction Cancelled"}
                  </h3>
                  <p
                    className="summary-banner-text"
                    data-testid="summary-banner-text"
                  >
                    {jobState.summary.done} exported, {jobState.summary.skipped}{" "}
                    skipped, {jobState.summary.failed} failed
                  </p>
                </div>
              </div>

              {/* Scrollable Items List */}
              <div className="items-list-container">
                <h4 className="items-list-title">Summary of Videos</h4>
                <div className="items-scroll-list" data-testid="items-list">
                  {jobState.items.map((item: JobItem, index: number) => (
                    <VideoItemRow
                      key={item.videoId}
                      item={item}
                      index={index}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

        {/* VIEW: Paused (Circuit Breaker) */}
        {viewState === "paused" && jobState && (
          <div className="completion-view" data-testid="paused-view">
            <div
              className="summary-banner banner-paused"
              data-testid="paused-banner"
            >
              <span className="summary-banner-icon">⏸</span>
              <div className="summary-banner-content">
                <h3
                  className="summary-banner-title"
                  data-testid="paused-banner-title"
                >
                  {errorMessage ||
                    jobState.error ||
                    "YouTube hız sınırı — tamamlananlar kaydedildi, sonra devam edebilirsin"}
                </h3>
                <p
                  className="summary-banner-text"
                  data-testid="summary-banner-text"
                >
                  {jobState.summary.done} exported, {jobState.summary.skipped}{" "}
                  skipped, {jobState.summary.failed} failed
                </p>
              </div>
            </div>

            {/* Scrollable Items List */}
            <div className="items-list-container">
              <h4 className="items-list-title">Summary of Videos</h4>
              <div className="items-scroll-list" data-testid="items-list">
                {jobState.items.map((item: JobItem, index: number) => (
                  <VideoItemRow key={item.videoId} item={item} index={index} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* VIEW E: Failed */}
        {viewState === "failed" && (
          <div className="failed-view" data-testid="failed-view">
            <div className="summary-banner banner-failed">
              <span className="summary-banner-icon">✕</span>
              <div className="summary-banner-content">
                <h3 className="summary-banner-title">Extraction Failed</h3>
                <p className="summary-banner-text">
                  {errorMessage ||
                    "An unexpected error occurred during extraction."}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4. Footer Action Bar */}
      <footer className="panel-footer">
        {viewState === "config" && (
          <button
            type="button"
            className="btn btn-primary"
            data-testid="start-btn"
            disabled={selectedFormats.length === 0}
            onClick={() => void startExtraction()}
          >
            Start Extraction
          </button>
        )}

        {viewState === "enumerating" && (
          <button
            type="button"
            className="btn btn-danger"
            data-testid="cancel-enum-btn"
            onClick={cancelExtraction}
          >
            Cancel
          </button>
        )}

        {viewState === "running" && (
          <button
            type="button"
            className="btn btn-danger"
            data-testid="cancel-job-btn"
            onClick={cancelExtraction}
          >
            Cancel Extraction
          </button>
        )}

        {(viewState === "completed" || viewState === "cancelled") && (
          <div className="footer-actions-group">
            <button
              type="button"
              className="btn btn-primary"
              data-testid="download-btn"
              disabled={
                isDownloading || !jobState || jobState.summary.done === 0
              }
              onClick={() => void downloadExport()}
            >
              {isDownloading ? "Preparing .zip..." : "Download (.zip)"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="new-job-btn"
              onClick={resetToConfig}
            >
              New Extraction
            </button>
          </div>
        )}

        {viewState === "paused" && (
          <div className="footer-actions-group">
            <button
              type="button"
              className="btn btn-primary"
              data-testid="resume-btn"
              onClick={() => void resumeExtraction()}
            >
              Resume Extraction
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="download-btn"
              disabled={
                isDownloading || !jobState || jobState.summary.done === 0
              }
              onClick={() => void downloadExport()}
            >
              {isDownloading ? "Preparing .zip..." : "Download (.zip)"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="new-job-btn"
              onClick={resetToConfig}
            >
              New Extraction
            </button>
          </div>
        )}

        {viewState === "failed" && (
          <button
            type="button"
            className="btn btn-primary"
            data-testid="retry-btn"
            onClick={resetToConfig}
          >
            Try Again
          </button>
        )}
      </footer>
    </div>
  );
};

interface VideoItemRowProps {
  item: JobItem;
  index: number;
}

const VideoItemRow: React.FC<VideoItemRowProps> = ({ item, index }) => {
  const statusLabel = formatStatusLabel(item.status, item.error?.code);
  const statusClass = `badge badge-${item.status}`;
  const errorMessage = item.error?.message
    ? item.error.message
    : item.error?.code
      ? EXTRACTION_ERROR_MESSAGES[item.error.code as ExtractionErrorCode]
      : undefined;

  return (
    <div className="video-item-row" data-testid={`video-item-${item.videoId}`}>
      <span className="video-index">#{index + 1}</span>
      <div className="video-info">
        <span className="video-title" title={item.title}>
          {item.title}
        </span>
        {errorMessage && (
          <span className="video-error-msg" title={errorMessage}>
            {errorMessage}
          </span>
        )}
      </div>
      <span className={statusClass} data-testid={`status-badge-${item.status}`}>
        {statusLabel}
      </span>
    </div>
  );
};

function formatStatusLabel(
  status: JobItem["status"],
  errorCode?: string
): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "fetching":
      return "Fetching...";
    case "done":
      return "Done";
    case "skipped":
      return errorCode === "LIVE_STREAM" ? "Live Stream" : "Skipped";
    case "failed":
      return errorCode ? errorCode.replace(/_/g, " ") : "Failed";
    default:
      return status;
  }
}
