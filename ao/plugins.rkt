#lang racket

(require racket/file racket/path racket/list racket/format "dsl.rkt")
(provide (struct-out plugin) discover-plugins reload-plugin run-plugin)

(struct plugin (path name render modified last-scene) #:transparent #:mutable)

(define (load-plugin path old)
  (with-handlers ([exn:fail? (lambda (e) (values old (exn-message e)))])
    (define ns (make-base-namespace))
    (define render (parameterize ([current-namespace ns]) (dynamic-require path 'render)))
    (define name (parameterize ([current-namespace ns]) (dynamic-require path 'name)))
    (unless (and (string? name) (procedure? render)) (error 'plugin "expected string name and render procedure"))
    (values (plugin path name render (file-or-directory-modify-seconds path) (and old (plugin-last-scene old))) #f)))

(define (discover-plugins dir)
  (for/list ([path (sort (directory-list dir #:build? #t) path<?)]
             #:when (regexp-match? #rx"\\.rkt$" (path->string path)))
    (define-values (p err) (load-plugin path #f))
    (if err (error 'discover-plugins "~a: ~a" path err) p)))

(define (reload-plugin p)
  (if (> (file-or-directory-modify-seconds (plugin-path p)) (plugin-modified p))
      (load-plugin (plugin-path p) p)
      (values p #f)))

(define (run-plugin p audio)
  (with-handlers ([exn:fail? (lambda (e) (values p (exn-message e)))])
    (define result ((plugin-render p) audio))
    (unless (scene? result) (error 'plugin "render must return a scene"))
    (set-plugin-last-scene! p result)
    (values p #f)))
