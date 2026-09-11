#lang racket

(provide (struct-out audio-frame) (struct-out scene)
         (struct-out rgba) (struct-out rect) (struct-out circle)
         (struct-out line) (struct-out polyline)
         rgb rgba* clamp lerp)

;; Plugins use normalized coordinates: x/y/width/height are 0..1.
;; Prefab structs make a scene safe to pass across the fresh namespaces used
;; for hot-loaded plugin modules.
(struct audio-frame (time waveform-left waveform-right spectrum loudness beat tempo width height) #:prefab)
(struct scene (background nodes) #:prefab)
(struct rgba (r g b a) #:prefab)
(struct rect (x y width height color) #:prefab)
(struct circle (x y radius color) #:prefab)
(struct line (x1 y1 x2 y2 width color) #:prefab)
(struct polyline (points width color) #:prefab)

(define (clamp x [low 0.0] [high 1.0]) (max low (min high x)))
(define (rgb r g b) (rgba r g b 1.0))
(define (rgba* r g b [a 1.0]) (rgba r g b a))
(define (lerp a b t) (+ a (* (- b a) (clamp t))))
