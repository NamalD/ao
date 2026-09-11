#lang racket

(require racket/port racket/string racket/list "dsl.rkt")
(provide start-audio-capture current-audio-frame parec-command)

(define latest (box (audio-frame 0.0 '() '() (make-list 48 0.0) 0.0 0.0 0.0 0.0 1280 720)))
(define previous-energy 0.0)
(define last-beat 0.0)
(define impulse-envelope 0.0)
(define previous-analysis-time #f)

(define (default-monitor)
  (define sink (string-trim (with-output-to-string (lambda () (system "pactl get-default-sink 2>/dev/null")))))
  (and (not (string=? sink "")) (string-append sink ".monitor")))

;; Use PipeWire's PulseAudio compatibility server: unlike `pw-record`, parec
;; understands the `.monitor` source name and cannot silently fall back to the
;; user's default input device.
;; `subprocess` needs an executable path; unlike a shell it does not perform a
;; PATH lookup for a bare program name.
(define (parec-command target [executable (find-executable-path "parec")])
  (and executable
       (list executable "--device" target "--format=float32le"
             "--rate=48000" "--channels=2" "--raw" "--latency-msec=20")))

(define (dft-band samples k)
  (define n (max 1 (length samples)))
  (/ (for/sum ([x samples] [i (in-naturals)])
       (* x (cos (/ (* 2.0 pi k i) n)))) n))

(define (analyse raw now)
  (define frames (quotient (bytes-length raw) 8))
  (define left (for/list ([i (in-range (min 256 frames))])
                 (floating-point-bytes->real raw #f (* i 8) (+ (* i 8) 4))))
  (define right (for/list ([i (in-range (min 256 frames))])
                  (floating-point-bytes->real raw #f (+ (* i 8) 4) (+ (* i 8) 8))))
  (define mono (map (lambda (a b) (* .5 (+ a b))) left right))
  (define energy (if (null? mono) 0.0 (sqrt (/ (for/sum ([x mono]) (* x x)) (length mono)))))
  ;; Compare against the smoothed energy baseline so a sudden hit gets a
  ;; strong response, while a sustained loud passage settles back down.
  (define attack (max 0.0 (- energy previous-energy)))
  (define raw-impulse (clamp (* 9.0 attack)))
  (define elapsed (if previous-analysis-time
                      (max 0.0 (- now previous-analysis-time))
                      0.0))
  (set! impulse-envelope
        (max raw-impulse (* impulse-envelope (exp (* -7.0 elapsed)))))
  (set! previous-analysis-time now)
  (define beat (if (and (> energy (+ (* previous-energy 1.35) .012)) (> (- now last-beat) .18)) 1.0 0.0))
  (set! previous-energy (+ (* .82 previous-energy) (* .18 energy)))
  (when (= beat 1.0) (set! last-beat now))
  (define spectrum
    (for/list ([i (in-range 48)])
      (min 1.0 (* 7.5 (abs (dft-band mono (+ 1 (inexact->exact (floor (* i i .12))))))))))
  (audio-frame now left right spectrum (min 1.0 (* 5 energy)) impulse-envelope beat 0.0 1280 720))

(define (start-audio-capture started-at [report (lambda (_message) (void))])
  (define target (default-monitor))
  (define parec (find-executable-path "parec"))
  (cond
    [(not target) (report "could not determine the default PipeWire monitor")]
    [(not parec) (report "parec is not installed or is not on PATH")]
    [else
    (with-handlers ([exn:fail? (lambda (e) (report (format "could not start capture: ~a" (exn-message e))))])
      (define-values (proc stdout stdin stderr)
        (apply subprocess #f #f #f (parec-command target parec)))
      (close-output-port stdin)
      (thread
       (lambda ()
         (with-handlers ([exn:fail? (lambda (e) (report (format "capture stopped: ~a" (exn-message e))))])
           (let loop ()
             (define bytes (read-bytes 2048 stdout))
             (unless (eof-object? bytes)
               (set-box! latest (analyse bytes (/ (- (current-inexact-milliseconds) started-at) 1000.0)))
               (loop)))))))]))

(define (current-audio-frame now width height)
  (define f (unbox latest))
  (struct-copy audio-frame f [time now] [width width] [height height]))
