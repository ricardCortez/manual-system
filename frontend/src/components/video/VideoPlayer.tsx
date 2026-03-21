import { useEffect, useRef, useState, useCallback } from "react";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import { Search, ChevronDown, BookOpen } from "lucide-react";
import api from "@/lib/api";

interface VideoChapter {
  id: string;
  title: string;
  startSeconds: number;
  endSeconds?: number;
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface VideoPlayerProps {
  hlsUrl: string;
  thumbnailUrl?: string;
  chapters?: VideoChapter[];
  transcriptSegments?: TranscriptSegment[];
  vttUrl?: string;
  title?: string;
  documentId?: string; // para tracking de visionado
}

export function VideoPlayer({
  hlsUrl,
  thumbnailUrl,
  chapters = [],
  transcriptSegments = [],
  vttUrl,
  title,
  documentId,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [activeSegment, setActiveSegment] = useState<number | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const [chaptersOpen, setChaptersOpen] = useState(true);

  // Tracking de visionado
  const maxPercentRef = useRef(0);
  const completedSentRef = useRef(false);
  const COMPLETION_THRESHOLD = 85;

  const sendProgress = useCallback((percent: number) => {
    if (!documentId) return;
    api.post(`/documents/${documentId}/video-view`, { percent }).catch(() => null);
  }, [documentId]);

  // Registrar apertura del video
  useEffect(() => {
    if (!documentId) return;
    api.post(`/documents/${documentId}/video-open`).catch(() => null);
  }, [documentId]);

  // ── Inicializar Video.js ───────────────────────────
  useEffect(() => {
    if (!videoRef.current || playerRef.current) return;

    const videoEl = document.createElement("video-js");
    videoEl.classList.add("vjs-big-play-centered", "vjs-fluid");
    videoRef.current.appendChild(videoEl);

    const player = videojs(videoEl, {
      controls: true,
      responsive: true,
      fluid: true,
      poster: thumbnailUrl,
      playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
      html5: {
        vhs: { overrideNative: true, enableLowInitialPlaylist: true },
        nativeVideoTracks: false,
        nativeAudioTracks: false,
        nativeTextTracks: false,
      },
      sources: [{ src: hlsUrl, type: "application/x-mpegURL" }],
    });

    // Subtítulos VTT
    if (vttUrl) {
      player.addRemoteTextTrack({ kind: "subtitles", src: vttUrl, srclang: "es", label: "Español" }, false);
    }

    // Teclado: espacio, ←→, F
    player.on("keydown", (e: KeyboardEvent) => {
      if (e.code === "Space") { e.preventDefault(); player.paused() ? player.play() : player.pause(); }
      if (e.code === "ArrowLeft") { e.preventDefault(); player.currentTime((player.currentTime() || 0) - 10); }
      if (e.code === "ArrowRight") { e.preventDefault(); player.currentTime((player.currentTime() || 0) + 10); }
      if (e.code === "KeyF") player.isFullscreen() ? player.exitFullscreen() : player.requestFullscreen();
    });

    // Actualizar tiempo para sincronizar transcript, capítulos y tracking
    player.on("timeupdate", () => {
      const time = player.currentTime() || 0;
      const duration = player.duration() || 0;
      setCurrentTime(time);

      // Segmento activo
      const idx = transcriptSegments.findIndex((s) => time >= s.start && time <= s.end);
      setActiveSegment(idx >= 0 ? idx : null);

      // Tracking de visionado
      if (documentId && duration > 0) {
        const percent = Math.round((time / duration) * 100);
        if (percent > maxPercentRef.current) {
          maxPercentRef.current = percent;
          // Enviar al backend cada 10% y al alcanzar el umbral por primera vez
          if (percent % 10 === 0 || (percent >= COMPLETION_THRESHOLD && !completedSentRef.current)) {
            if (percent >= COMPLETION_THRESHOLD) completedSentRef.current = true;
            sendProgress(percent);
          }
        }
      }
    });

    playerRef.current = player;

    return () => {
      if (playerRef.current && !playerRef.current.isDisposed()) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [hlsUrl]);

  const seekTo = (seconds: number) => {
    playerRef.current?.currentTime(seconds);
    playerRef.current?.play();
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const filteredSegments = transcriptSearch
    ? transcriptSegments.filter((s) => s.text.toLowerCase().includes(transcriptSearch.toLowerCase()))
    : transcriptSegments;

  const activeChapter = [...chapters].reverse().find((c) => currentTime >= c.startSeconds);

  return (
    <div>
      {/* ── Reproductor ──────────────────────────────── */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: "#000", boxShadow: "var(--shadow-lg)" }}
      >
        <div ref={videoRef} />
      </div>

      {title && (
        <h2 className="font-display text-xl font-600 mt-4 mb-1" style={{ color: "var(--text-primary)" }}>
          {title}
        </h2>
      )}

      {activeChapter && (
        <p className="text-sm mb-4" style={{ color: "var(--text-tertiary)" }}>
          Capítulo: {activeChapter.title}
        </p>
      )}

      {/* ── Capítulos ─────────────────────────────────── */}
      {chapters.length > 0 && (
        <div
          className="rounded-xl mt-4 overflow-hidden"
          style={{ border: "1px solid var(--border-subtle)" }}
        >
          <button
            onClick={() => setChaptersOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3"
            style={{ background: "var(--bg-secondary)" }}
          >
            <div className="flex items-center gap-2">
              <BookOpen size={15} style={{ color: "var(--text-secondary)" }} />
              <span className="text-sm font-500" style={{ color: "var(--text-primary)" }}>
                Capítulos ({chapters.length})
              </span>
            </div>
            <ChevronDown
              size={15}
              style={{ color: "var(--text-tertiary)", transform: chaptersOpen ? "rotate(180deg)" : "none", transition: "transform 200ms" }}
            />
          </button>

          {chaptersOpen && (
            <div className="divide-y" style={{ borderTop: "1px solid var(--border-subtle)" }}>
              {chapters.map((chapter) => {
                const isActive = currentTime >= chapter.startSeconds &&
                  (!chapter.endSeconds || currentTime < chapter.endSeconds);
                return (
                  <button
                    key={chapter.id}
                    onClick={() => seekTo(chapter.startSeconds)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors hover:opacity-80"
                    style={{
                      background: isActive ? "var(--ai-bg)" : "transparent",
                      color: isActive ? "var(--ai-primary)" : "var(--text-secondary)",
                    }}
                  >
                    <span
                      className="text-xs font-mono shrink-0 px-1.5 py-0.5 rounded"
                      style={{ background: "var(--bg-tertiary)", color: "var(--text-tertiary)" }}
                    >
                      {formatTime(chapter.startSeconds)}
                    </span>
                    <span className="flex-1">{chapter.title}</span>
                    {isActive && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--ai-primary)" }} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Transcripción — SIN IA ────────────────────── */}
      {transcriptSegments.length > 0 && (
        <div
          className="rounded-xl mt-4 overflow-hidden"
          style={{ border: "1px solid var(--border-subtle)" }}
        >
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)" }}
          >
            <button
              onClick={() => setTranscriptOpen((v) => !v)}
              className="flex items-center gap-2"
            >
              <span className="text-sm font-500" style={{ color: "var(--text-primary)" }}>
                Transcripción
              </span>
              <ChevronDown
                size={15}
                style={{ color: "var(--text-tertiary)", transform: transcriptOpen ? "rotate(180deg)" : "none", transition: "transform 200ms" }}
              />
            </button>

            {/* Búsqueda en transcripción */}
            {transcriptOpen && (
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm"
                style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)" }}
              >
                <Search size={13} style={{ color: "var(--text-tertiary)" }} />
                <input
                  type="text"
                  value={transcriptSearch}
                  onChange={(e) => setTranscriptSearch(e.target.value)}
                  placeholder="Buscar en transcripción..."
                  className="bg-transparent outline-none text-xs w-40"
                  style={{ color: "var(--text-primary)" }}
                />
              </div>
            )}
          </div>

          {transcriptOpen && (
            <div className="max-h-72 overflow-y-auto">
              {filteredSegments.map((seg, i) => {
                const isActive = activeSegment !== null && transcriptSegments[activeSegment] === seg;
                const searchMatch = transcriptSearch && seg.text.toLowerCase().includes(transcriptSearch.toLowerCase());

                return (
                  <button
                    key={i}
                    onClick={() => seekTo(seg.start)}
                    className="w-full flex gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:opacity-80"
                    style={{
                      background: isActive ? "var(--bg-tertiary)" : "transparent",
                      borderBottom: "1px solid var(--border-subtle)",
                    }}
                  >
                    <span
                      className="text-xs font-mono shrink-0 mt-0.5"
                      style={{ color: "var(--text-tertiary)", minWidth: 42 }}
                    >
                      {formatTime(seg.start)}
                    </span>
                    <span
                      className="leading-relaxed"
                      style={{ color: isActive ? "var(--text-primary)" : "var(--text-secondary)" }}
                      dangerouslySetInnerHTML={{
                        __html: searchMatch
                          ? seg.text.replace(
                              new RegExp(transcriptSearch, "gi"),
                              (m) => `<mark style="background:var(--ai-bg);color:var(--ai-primary)">${m}</mark>`
                            )
                          : seg.text,
                      }}
                    />
                  </button>
                );
              })}

              {transcriptSearch && filteredSegments.length === 0 && (
                <p className="text-center py-6 text-sm" style={{ color: "var(--text-tertiary)" }}>
                  No se encontró "{transcriptSearch}" en la transcripción
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Nota explícita: sin IA en videos */}
      <p className="text-xs mt-3 text-center" style={{ color: "var(--text-disabled)" }}>
        Los videos no incluyen resúmenes IA · Solo transcripción automática Whisper
      </p>
    </div>
  );
}
