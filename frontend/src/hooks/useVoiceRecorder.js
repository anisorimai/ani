import { useCallback, useRef, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import useVoiceStore from '../store/useVoiceStore';

const MAX_RECORDING_SECONDS  = 60;
const NO_SPEECH_TIMEOUT_MS   = 3000;  // stop if user never speaks within 3 s
const TRAILING_SILENCE_MS    = 5000;  // stop 5 s after user goes quiet
const SPEECH_THRESHOLD       = 0.04;  // RMS threshold — high enough to reject ambient mic noise
const SPEECH_CONFIRM_FRAMES  = 4;     // consecutive frames above threshold required to confirm speech

/**
 * Custom hook for voice recording using MediaRecorder + Web Audio API.
 *
 * Features:
 * - Real-time volume levels for visualizer
 * - Auto-stop after 60 seconds
 * - Minimum volume threshold (rejects silent recordings)
 * - Trailing-silence auto-stop: stops 5 s after user goes quiet, then sends as query
 * - Permission error handling with user-facing toasts
 * - Proper cleanup on unmount
 */
export default function useVoiceRecorder() {
  const mediaRecorderRef       = useRef(null);
  const audioContextRef        = useRef(null);
  const analyserRef            = useRef(null);
  const animFrameRef           = useRef(null);
  const chunksRef              = useRef([]);
  const streamRef              = useRef(null);
  const timerRef               = useRef(null);
  const autoStopRef            = useRef(null);
  const volumeSamplesRef       = useRef([]);
  const hasSpeechRef           = useRef(false);
  const noSpeechToastShownRef  = useRef(false); // true when silence timer already toasted
  const silenceTimerRef        = useRef(null);  // fires if no speech in 3 s
  const trailingSilenceRef     = useRef(null);  // restarted on every speech frame; fires 1.5 s after user goes quiet

  const {
    setRecording,
    setRecordingDuration,
    setAudioBlob,
    setVolume,
    setAverageVolume,
    setError,
    reset,
  } = useVoiceStore();

  // Clean up on unmount
  useEffect(() => {
    return () => { cleanupAll(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cleanupAll = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (trailingSilenceRef.current) {
      clearTimeout(trailingSilenceRef.current);
      trailingSilenceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  /**
   * Start analysing volume from the mic stream
   */
  const startAnalyser = useCallback((stream) => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source       = audioContext.createMediaStreamSource(stream);
      const analyser     = audioContext.createAnalyser();
      analyser.fftSize               = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current     = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let consecutiveSpeechFrames = 0;

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(dataArray);

        // Calculate RMS volume from waveform values centered at 128.
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const sample = (dataArray[i] - 128) / 128;
          sum += sample * sample;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        setVolume(rms);
        volumeSamplesRef.current.push(rms);

        if (rms > SPEECH_THRESHOLD) {
          consecutiveSpeechFrames++;

          // Require SPEECH_CONFIRM_FRAMES consecutive frames to rule out noise spikes.
          if (consecutiveSpeechFrames >= SPEECH_CONFIRM_FRAMES && !hasSpeechRef.current) {
            hasSpeechRef.current = true;
            if (silenceTimerRef.current) {
              clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = null;
            }
          }

          // Only arm the trailing-silence timer once real speech is confirmed.
          if (hasSpeechRef.current) {
            clearTimeout(trailingSilenceRef.current);
            trailingSilenceRef.current = setTimeout(() => {
              if (mediaRecorderRef.current?.state !== 'inactive') {
                mediaRecorderRef.current.stop();
              }
            }, TRAILING_SILENCE_MS);
          }
        } else {
          consecutiveSpeechFrames = 0;
        }

        animFrameRef.current = requestAnimationFrame(tick);
      };

      tick();
    } catch (e) {
      console.warn('Audio analyser error:', e);
    }
  }, [setVolume]);

  /**
   * Start recording audio
   */
  const startRecording = useCallback(async () => {
    try {
      reset();
      volumeSamplesRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: { ideal: 16000 },
        },
      });

      streamRef.current  = stream;
      chunksRef.current  = [];

      // Determine best MIME type — order matches Whisper-supported formats
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')            ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')             ? 'audio/mp4'
        : '';

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const durationSeconds = useVoiceStore.getState().recordingDuration;
        const actualType      = mimeType || recorder.mimeType || 'audio/webm';
        const blob            = new Blob(chunksRef.current, { type: actualType });

        // Average volume across the session
        const samples = volumeSamplesRef.current;
        const avg = samples.length > 0
          ? samples.reduce((a, b) => a + b, 0) / samples.length
          : 0;
        setAverageVolume(avg);

        /* ── Quality checks ─────────────── */
        // Silently drop accidental taps (< ~800 ms)
        if (durationSeconds < 1 && samples.length < 8) {
          toast('Hold to record, then tap to stop', { icon: '🎤', duration: 2500 });
          setRecording(false);
          setVolume(0);
          doCleanup();
          return;
        }

        // Discard recordings where no speech was ever detected (prevents
        // Whisper hallucinations on silent audio reaching the AI agent).
        if (!hasSpeechRef.current) {
          if (!noSpeechToastShownRef.current) {
            toast('No speech detected', { icon: '🎤', duration: 2000 });
          }
          noSpeechToastShownRef.current = false;
          setRecording(false);
          setVolume(0);
          doCleanup();
          return;
        }

        setAudioBlob(blob);
        setRecording(false);
        setVolume(0);
        doCleanup();
      };

      recorder.onerror = () => {
        const msg = 'Recording failed. Please try again.';
        setError(msg);
        toast.error(msg);
        cleanupAll();
      };

      // Start recording — collect data every 100ms
      recorder.start(100);
      setRecording(true);

      // Start volume analyser
      hasSpeechRef.current          = false;
      noSpeechToastShownRef.current = false;
      startAnalyser(stream);

      // Duration timer
      let seconds = 0;
      timerRef.current = setInterval(() => {
        seconds += 1;
        setRecordingDuration(seconds);
      }, 1000);

      // Auto-stop if no speech detected within 3 s
      silenceTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state !== 'inactive') {
          noSpeechToastShownRef.current = true;
          toast('No speech detected', { icon: '🎤', duration: 2000 });
          mediaRecorderRef.current.stop();
        }
      }, NO_SPEECH_TIMEOUT_MS);

      // Hard cap at MAX_RECORDING_SECONDS
      autoStopRef.current = setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      }, MAX_RECORDING_SECONDS * 1000);

    } catch (err) {
      if (err.name === 'NotAllowedError') {
        const msg = 'Microphone access denied — please allow microphone in browser settings.';
        setError(msg);
        toast.error(msg);
      } else if (err.name === 'NotFoundError') {
        const msg = 'No microphone found — please connect a microphone.';
        setError(msg);
        toast.error(msg);
      } else {
        const msg = 'Could not access microphone. Please try again.';
        setError(msg);
        toast.error(msg);
      }
    }
  }, [reset, setRecording, setRecordingDuration, setAudioBlob, setVolume, setAverageVolume, setError, startAnalyser, cleanupAll]);

  /**
   * Internal cleanup after onstop (separate from full cleanupAll so mic release stays here)
   */
  function doCleanup() {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (trailingSilenceRef.current) {
      clearTimeout(trailingSilenceRef.current);
      trailingSilenceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  /**
   * Stop recording (user-initiated or auto-stop)
   */
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  return { startRecording, stopRecording };
}
