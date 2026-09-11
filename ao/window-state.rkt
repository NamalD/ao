#lang racket

(require racket/file)

(provide window-position?
         window-position
         window-position-x
         window-position-y
         load-window-position
         save-window-position!)

(struct window-position (x y) #:transparent)

(define (valid-position? value)
  (and (list? value)
       (= (length value) 2)
       (andmap exact-integer? value)))

(define (load-window-position path)
  (with-handlers ([exn:fail? (lambda (_) #f)])
    (define value (call-with-input-file path read))
    (and (valid-position? value)
         (window-position (first value) (second value)))))

(define (save-window-position! path position)
  (call-with-output-file path #:exists 'truncate
    (lambda (out)
      (write (list (window-position-x position)
                   (window-position-y position)) out))))
