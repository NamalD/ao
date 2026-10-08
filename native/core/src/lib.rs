//! The allocation-free push. After construction and one warm-up, [`Analysis::push`]
//! does not allocate: `listen` promises that, and the copies here are into
//! buffers this struct already owns. A section event's detail string is
//! allocated only on the push that fires one.

use listen::{Features, Frame, Listener, SectionDetector, SectionEvent, SPECTRUM_BANDS, WAVE_SIZE};

pub const SCALAR_LEN: usize = 15;

pub struct Outputs {
    pub scalars: [f64; SCALAR_LEN],
    pub spectrum: [f32; SPECTRUM_BANDS],
    pub wave: [f32; WAVE_SIZE],
    pub chroma: [f32; 12],
}

pub struct Analysis {
    listener: Listener,
    /// Autopilot's detector. Independent of the one inside `Listener`, so a
    /// reset does not forget the levels sketches are reading.
    sections: SectionDetector,
    pub out: Outputs,
    pending: Option<SectionEvent>,
}

impl Analysis {
    pub fn new(sample_rate: u32) -> Self {
        assert!(
            (8_000..=192_000).contains(&sample_rate),
            "sample rate {sample_rate} Hz is outside 8–192 kHz"
        );
        Self {
            listener: Listener::new(sample_rate),
            sections: SectionDetector::new(),
            out: Outputs {
                scalars: [0.0; SCALAR_LEN],
                spectrum: [0.0; SPECTRUM_BANDS],
                wave: [0.0; WAVE_SIZE],
                chroma: [0.0; 12],
            },
            pending: None,
        }
    }

    /// Folds in the next interleaved frames. Empty input changes nothing.
    pub fn push(&mut self, frames: &[Frame]) {
        if frames.is_empty() {
            return;
        }
        let Analysis { listener, sections, out, pending } = self;
        let features = listener.push(frames);
        write_outputs(out, features);
        if let Some(event) = sections.push(features) {
            *pending = Some(event);
        }
    }

    pub fn take_event(&mut self) -> Option<SectionEvent> {
        self.pending.take()
    }

    pub fn reset_sections(&mut self) {
        self.sections.reset();
        self.pending = None;
    }
}

fn write_outputs(out: &mut Outputs, features: &Features) {
    let s = &mut out.scalars;
    s[0] = features.time;
    s[1] = features.loudness as f64;
    s[2] = features.impulse as f64;
    s[3] = features.beat as f64;
    s[4] = features.bass as f64;
    s[5] = features.mid as f64;
    s[6] = features.high as f64;
    s[7] = features.stereo.balance as f64;
    s[8] = features.stereo.width as f64;
    s[9] = features.chroma.key as u8 as f64;
    s[10] = features.energy as f64;
    s[11] = features.drop as f64;
    s[12] = features.tempo.bpm;
    s[13] = features.tempo.beats;
    s[14] = features.tempo.confidence as f64;
    out.spectrum.copy_from_slice(&features.spectrum.0);
    out.wave.copy_from_slice(&features.wave.0);
    out.chroma.copy_from_slice(&features.chroma.strengths);
}

/// A feature frame for [`SectionDetector`], which reads time, loudness, bass and spectrum.
pub fn features_from(time: f64, loudness: f64, bass: f64, spectrum: &[f64]) -> Features {
    let mut features = Features::silent(time);
    features.loudness = loudness as f32;
    features.bass = bass as f32;
    let n = spectrum.len().min(SPECTRUM_BANDS);
    for (band, value) in features.spectrum.0[..n].iter_mut().zip(spectrum) {
        *band = *value as f32;
    }
    features
}
