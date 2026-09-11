#lang racket
(require rackunit racket/file "../ao/dsl.rkt" "../ao/audio.rkt" "../ao/plugins.rkt")
(check-equal? (clamp -1) 0.0)
(check-equal? (clamp 2) 1.0)
(check-equal? (lerp 0 10 .25) 2.5)
(check-true (scene? (scene (rgb 0 0 0) '())))
(check-true (gradient-circle? (gradient-circle .5 .5 .1 (rgb 1 0 0) (rgba* 1 0 0 0))))
(check-true (gradient-rect? (gradient-rect 0 0 1 1 (rgb 0 0 0) (rgb 1 1 1))))
(check-true (group? (group '() 0 0 1 0 1 "add")))

;; Regression for the idle-only bug: subprocess must receive /usr/bin/parec
;; (or equivalent), not the bare string that a shell would resolve via PATH.
(define capture (parec-command "test.monitor" "/usr/bin/parec"))
(check-equal? (car capture) "/usr/bin/parec")
(check-equal? (cadr capture) "--device")
(check-equal? (caddr capture) "test.monitor")

;; Newly added plugin files are discovered without replacing loaded plugins.
(define plugin-dir (make-temporary-file "ao-plugin-test~a" 'directory (current-directory)))
(define plugin-path (build-path plugin-dir "new.rkt"))
(call-with-output-file plugin-path
  (lambda (out)
    (display "#lang racket\n(provide name render)\n(define name \"New\")\n(define (render a) #f)\n" out)))
(define-values (discovered discovery-errors) (rescan-plugins plugin-dir '()))
(check-equal? discovery-errors '())
(check-equal? (map plugin-name discovered) '("New"))
(define-values (rescanned rescan-errors) (rescan-plugins plugin-dir discovered))
(check-equal? rescan-errors '())
(check-true (eq? (car discovered) (car rescanned)))
(delete-directory/files plugin-dir)
