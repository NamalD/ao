//! Ao's audio analysis, as a Node addon over the `listen` crate.
//!
//! napi rather than WASM: on 960-frame chunks the napi push measured 20.7 µs
//! and the wasm push 29.5 µs, boundary included. napi does not copy the input.
//! `push` writes into typed arrays created once; it does not allocate per chunk.

use ao_listen_core::{features_from, Analysis, SCALAR_LEN};
use listen::{Frame, SectionDetector as ListenSections, SectionKind, Synthetic as ListenSynthetic, TempoTracker as ListenTempo, SPECTRUM_BANDS, WAVE_SIZE};
use napi::bindgen_prelude::*;
use napi::sys::{self, napi_ref};
use napi::{check_status, Env, JsUnknown, NapiRaw, NapiValue};
use napi_derive::napi;

/// The parec invocation capture spawns. `executable` is used as given, so the
/// caller can pass an absolute path and the child does not search PATH.
#[napi]
pub fn parec_command(target: String, executable: String) -> Vec<String> {
    vec![
        executable,
        "--device".into(),
        target,
        "--format=float32le".into(),
        "--rate=48000".into(),
        "--channels=2".into(),
        "--raw".into(),
        "--latency-msec=20".into(),
    ]
}

#[napi(object)]
pub struct SectionEventObject {
    pub kind: String,
    pub time: f64,
    pub strength: f64,
    pub detail: String,
}

#[napi(object)]
pub struct EnergyReading {
    pub energy: f64,
    pub drop: f64,
}

#[napi(object)]
pub struct TempoReading {
    pub bpm: f64,
    pub beats: f64,
    pub confidence: f64,
}

fn event_object(event: listen::SectionEvent) -> SectionEventObject {
    SectionEventObject {
        kind: match event.kind {
            SectionKind::Drop => "drop",
            SectionKind::Breakdown => "breakdown",
            SectionKind::Change => "change",
        }
        .into(),
        time: event.time,
        strength: event.strength as f64,
        detail: event.detail,
    }
}

struct Views {
    scalars: napi_ref,
    spectrum: napi_ref,
    wave: napi_ref,
    chroma: napi_ref,
}

impl Views {
    fn create(env: sys::napi_env) -> Result<Self> {
        Ok(Self {
            scalars: reference(env, f64_array(env, SCALAR_LEN)?)?,
            spectrum: reference(env, f32_array(env, SPECTRUM_BANDS)?)?,
            wave: reference(env, f32_array(env, WAVE_SIZE)?)?,
            chroma: reference(env, f32_array(env, 12)?)?,
        })
    }
}

fn f32_array(env: sys::napi_env, len: usize) -> Result<sys::napi_value> {
    unsafe { Float32Array::to_napi_value(env, Float32Array::new(vec![0.0; len])) }
}

fn f64_array(env: sys::napi_env, len: usize) -> Result<sys::napi_value> {
    unsafe { Float64Array::to_napi_value(env, Float64Array::new(vec![0.0; len])) }
}

fn reference(env: sys::napi_env, value: sys::napi_value) -> Result<napi_ref> {
    let mut reference = std::ptr::null_mut();
    check_status!(
        unsafe { sys::napi_create_reference(env, value, 1, &mut reference) },
        "create reference"
    )?;
    Ok(reference)
}

fn referenced<'a>(env: sys::napi_env, reference: napi_ref) -> Result<JsUnknown> {
    let mut value = std::ptr::null_mut();
    check_status!(
        unsafe { sys::napi_get_reference_value(env, reference, &mut value) },
        "get reference"
    )?;
    Ok(unsafe { JsUnknown::from_raw_unchecked(env, value) })
}

/// Borrow a Float32Array for this call, without creating a napi reference.
unsafe fn frames_of<'a>(env: sys::napi_env, value: sys::napi_value) -> Result<&'a mut [Frame]> {
    let mut ty = 0;
    let mut length = 0usize;
    let mut data = std::ptr::null_mut();
    let mut buffer = std::ptr::null_mut();
    let mut offset = 0usize;
    check_status!(
        unsafe {
            sys::napi_get_typedarray_info(env, value, &mut ty, &mut length, &mut data, &mut buffer, &mut offset)
        },
        "typed array info"
    )?;
    if ty != sys::TypedarrayType::float32_array {
        return Err(Error::from_reason("expected a Float32Array"));
    }
    if data.is_null() || length < 2 {
        return Ok(&mut []);
    }
    let samples = unsafe { std::slice::from_raw_parts_mut(data.cast::<f32>(), length) };
    Ok(samples.as_chunks_mut::<2>().0)
}

fn write_view(env: sys::napi_env, reference: napi_ref, data: &[f32]) -> Result<()> {
    let mut value = std::ptr::null_mut();
    check_status!(
        unsafe { sys::napi_get_reference_value(env, reference, &mut value) },
        "get reference"
    )?;
    let mut ty = 0;
    let mut length = 0usize;
    let mut ptr = std::ptr::null_mut();
    let mut buffer = std::ptr::null_mut();
    let mut offset = 0usize;
    check_status!(
        unsafe { sys::napi_get_typedarray_info(env, value, &mut ty, &mut length, &mut ptr, &mut buffer, &mut offset) },
        "typed array info"
    )?;
    if length != data.len() {
        return Err(Error::from_reason("output buffer has the wrong length"));
    }
    unsafe { std::slice::from_raw_parts_mut(ptr.cast::<f32>(), length) }.copy_from_slice(data);
    Ok(())
}

fn write_scalars(env: sys::napi_env, reference: napi_ref, data: &[f64]) -> Result<()> {
    let mut value = std::ptr::null_mut();
    check_status!(
        unsafe { sys::napi_get_reference_value(env, reference, &mut value) },
        "get reference"
    )?;
    let mut ty = 0;
    let mut length = 0usize;
    let mut ptr = std::ptr::null_mut();
    let mut buffer = std::ptr::null_mut();
    let mut offset = 0usize;
    check_status!(
        unsafe { sys::napi_get_typedarray_info(env, value, &mut ty, &mut length, &mut ptr, &mut buffer, &mut offset) },
        "typed array info"
    )?;
    unsafe { std::slice::from_raw_parts_mut(ptr.cast::<f64>(), length) }.copy_from_slice(data);
    Ok(())
}

/// One capture's analysis. `push` reads the caller's samples in place and
/// writes features into arrays this engine created once.
#[napi]
pub struct Engine {
    analysis: Analysis,
    views: Option<Views>,
}

#[napi]
impl Engine {
    #[napi(constructor)]
    pub fn new(rate: u32) -> Result<Self> {
        if !(8_000..=192_000).contains(&rate) {
            return Err(Error::from_reason(format!("sample rate {rate} Hz is outside 8–192 kHz")));
        }
        Ok(Self { analysis: Analysis::new(rate), views: None })
    }

    #[napi]
    pub fn push(&mut self, env: Env, samples: JsUnknown) -> Result<()> {
        let env = env.raw();
        let frames = unsafe { frames_of(env, samples.raw())? };
        self.analysis.push(frames);
        self.publish(env)
    }

    #[napi]
    pub fn reset_sections(&mut self) {
        self.analysis.reset_sections();
    }

    /// The autopilot event since the last call, or null. Allocates only when one fired.
    #[napi]
    pub fn take_section(&mut self) -> Option<SectionEventObject> {
        self.analysis.take_event().map(event_object)
    }

    #[napi(getter)]
    pub fn scalars(&mut self, env: Env) -> Result<JsUnknown> {
        let env = env.raw();
        self.publish(env)?;
        referenced(env, self.views.as_ref().unwrap().scalars)
    }

    #[napi(getter)]
    pub fn spectrum(&mut self, env: Env) -> Result<JsUnknown> {
        let env = env.raw();
        self.publish(env)?;
        referenced(env, self.views.as_ref().unwrap().spectrum)
    }

    #[napi(getter)]
    pub fn wave(&mut self, env: Env) -> Result<JsUnknown> {
        let env = env.raw();
        self.publish(env)?;
        referenced(env, self.views.as_ref().unwrap().wave)
    }

    #[napi(getter)]
    pub fn chroma(&mut self, env: Env) -> Result<JsUnknown> {
        let env = env.raw();
        self.publish(env)?;
        referenced(env, self.views.as_ref().unwrap().chroma)
    }

    fn publish(&mut self, env: sys::napi_env) -> Result<()> {
        if self.views.is_none() {
            self.views = Some(Views::create(env)?);
        }
        let views = self.views.as_ref().unwrap();
        let out = &self.analysis.out;
        write_scalars(env, views.scalars, &out.scalars)?;
        write_view(env, views.spectrum, &out.spectrum)?;
        write_view(env, views.wave, &out.wave)?;
        write_view(env, views.chroma, &out.chroma)?;
        Ok(())
    }
}

/// Section events from synthetic feature frames. Autopilot's detector in the
/// capture engine is the same type; this one is for tests and for driving
/// energy without PCM.
#[napi]
pub struct SectionDetector {
    inner: ListenSections,
}

#[napi]
impl SectionDetector {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self { inner: ListenSections::new() }
    }

    #[napi]
    pub fn push(&mut self, time: f64, loudness: f64, bass: f64, spectrum: Vec<f64>) -> Option<SectionEventObject> {
        self.inner.push(&features_from(time, loudness, bass, &spectrum)).map(event_object)
    }

    #[napi(getter)]
    pub fn energy(&self) -> f64 {
        self.inner.energy() as f64
    }

    #[napi]
    pub fn reset(&mut self) {
        self.inner.reset();
    }
}

/// `energy` and `drop` the way `Listener` fills them, driven by feature frames.
#[napi]
pub struct EnergyTracker {
    detector: ListenSections,
    drop: f32,
    last: Option<f64>,
}

#[napi]
impl EnergyTracker {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self { detector: ListenSections::new(), drop: 0.0, last: None }
    }

    #[napi]
    pub fn push(&mut self, time: f64, loudness: f64, bass: f64, spectrum: Vec<f64>) -> EnergyReading {
        let dt = self.last.map(|prev| (time - prev).max(0.0) as f32).unwrap_or(0.0);
        self.last = Some(time);
        let event = self.detector.push(&features_from(time, loudness, bass, &spectrum));
        self.drop = match event {
            Some(event) if event.kind == SectionKind::Drop => 1.0,
            _ => self.drop * (-dt / 0.5).exp(),
        };
        EnergyReading { energy: self.detector.energy() as f64, drop: self.drop as f64 }
    }
}

#[napi]
pub struct TempoTracker {
    inner: ListenTempo,
}

#[napi]
impl TempoTracker {
    #[napi(constructor)]
    pub fn new(rate: u32) -> Result<Self> {
        if !(8_000..=192_000).contains(&rate) {
            return Err(Error::from_reason(format!("sample rate {rate} Hz is outside 8–192 kHz")));
        }
        Ok(Self { inner: ListenTempo::new(rate) })
    }

    #[napi]
    pub fn push(&mut self, env: Env, samples: JsUnknown) -> Result<TempoReading> {
        let frames = unsafe { frames_of(env.raw(), samples.raw())? };
        let tempo = self.inner.push(frames);
        Ok(TempoReading { bpm: tempo.bpm, beats: tempo.beats, confidence: tempo.confidence as f64 })
    }
}

/// The deterministic kick, pad and hats signal, written into the caller's buffer.
#[napi]
pub struct Synthetic {
    inner: ListenSynthetic,
}

#[napi]
impl Synthetic {
    #[napi(constructor)]
    pub fn new(rate: u32) -> Self {
        Self { inner: ListenSynthetic::new(rate) }
    }

    #[napi]
    pub fn fill(&mut self, env: Env, samples: JsUnknown) -> Result<()> {
        let frames = unsafe { frames_of(env.raw(), samples.raw())? };
        self.inner.fill(frames);
        Ok(())
    }
}
