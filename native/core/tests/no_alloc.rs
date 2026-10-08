//! After a warm-up, a push must not allocate. That is the boundary contract:
//! the addon writes into buffers it already owns.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use ao_listen_core::Analysis;

struct Counting;

static ALLOCS: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::SeqCst);
        unsafe { System.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::SeqCst);
        unsafe { System.alloc_zeroed(layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::SeqCst);
        unsafe { System.realloc(ptr, layout, new_size) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

#[test]
fn push_allocates_nothing_after_warmup() {
    let mut analysis = Analysis::new(48_000);
    let frames = vec![[0.2f32; 2]; 960];
    analysis.push(&frames);
    let before = ALLOCS.load(Ordering::SeqCst);
    for _ in 0..200 {
        analysis.push(&frames);
    }
    analysis.push(&[]);
    assert_eq!(ALLOCS.load(Ordering::SeqCst), before, "a push allocated");
}
