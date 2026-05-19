use std::path::Path;
use crate::audio_preprocessing;
use crate::project::{SpeakerGender, SubtitleSegment};

const SAMPLE_RATE: u32 = 16_000;
const FRAME_SIZE: usize = 1024;
const HOP_SIZE: usize = 512;
const MIN_PITCH_HZ: f64 = 75.0;
const MAX_PITCH_HZ: f64 = 350.0;
/// Медианная F0 ниже порога: чаще мужской голос
const MALE_PITCH_BELOW_HZ: f64 = 155.0;
/// Медианная F0 выше порога: чаще женский голос
const FEMALE_PITCH_ABOVE_HZ: f64 = 185.0;

/// Пол говорящего по F0 для каждого сегмента
pub async fn assign_speaker_genders(
    audio_path: &Path,
    segments: &mut [SubtitleSegment],
) -> Result<(), String> {
    if segments.is_empty() {
        return Ok(());
    }

    let pcm = audio_preprocessing::decode_pcm_16k_mono(audio_path).await?;
    let sr = SAMPLE_RATE as f64;

    for segment in segments.iter_mut() {
        let start_idx = (segment.start * sr).floor() as usize;
        let end_idx = ((segment.end * sr).ceil() as usize).min(pcm.len());

        if end_idx <= start_idx || end_idx - start_idx < SAMPLE_RATE as usize / 20 {
            segment.speaker_gender = Some(SpeakerGender::Unknown);
            continue;
        }

        let slice = &pcm[start_idx..end_idx];
        segment.speaker_gender = Some(detect_gender_from_pcm(slice, SAMPLE_RATE));
    }

    let male = segments
        .iter()
        .filter(|s| matches!(s.speaker_gender, Some(SpeakerGender::Male)))
        .count();
    let female = segments
        .iter()
        .filter(|s| matches!(s.speaker_gender, Some(SpeakerGender::Female)))
        .count();
    let unknown = segments.len() - male - female;
    println!(
        "[gender] сегментов: {} (male: {}, female: {}, unknown: {})",
        segments.len(),
        male,
        female,
        unknown
    );

    Ok(())
}

fn detect_gender_from_pcm(samples: &[i16], sample_rate: u32) -> SpeakerGender {
    let mut pitches = Vec::new();
    let mut offset = 0usize;

    while offset + FRAME_SIZE <= samples.len() {
        let frame = &samples[offset..offset + FRAME_SIZE];
        if frame_rms(frame) >= 0.012 {
            if let Some(hz) = estimate_pitch_hz(frame, sample_rate) {
                pitches.push(hz);
            }
        }
        offset += HOP_SIZE;
    }

    if pitches.is_empty() {
        return SpeakerGender::Unknown;
    }

    pitches.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = pitches[pitches.len() / 2];

    if median < MALE_PITCH_BELOW_HZ {
        SpeakerGender::Male
    } else if median > FEMALE_PITCH_ABOVE_HZ {
        SpeakerGender::Female
    } else {
        SpeakerGender::Unknown
    }
}

fn frame_rms(frame: &[i16]) -> f64 {
    let sum: f64 = frame
        .iter()
        .map(|&s| {
            let x = s as f64 / 32768.0;
            x * x
        })
        .sum();
    (sum / frame.len() as f64).sqrt()
}

fn estimate_pitch_hz(frame: &[i16], sample_rate: u32) -> Option<f64> {
    let samples: Vec<f64> = frame.iter().map(|&s| s as f64 / 32768.0).collect();
    let min_lag = (sample_rate as f64 / MAX_PITCH_HZ).floor() as usize;
    let max_lag = (sample_rate as f64 / MIN_PITCH_HZ).ceil() as usize;
    let max_lag = max_lag.min(samples.len() / 2);

    if min_lag >= max_lag {
        return None;
    }

    let mut best_lag = min_lag;
    let mut best_corr = f64::MIN;

    for lag in min_lag..=max_lag {
        let corr = autocorrelation(&samples, lag);
        if corr > best_corr {
            best_corr = corr;
            best_lag = lag;
        }
    }

    if best_corr < 0.02 {
        return None;
    }

    Some(sample_rate as f64 / best_lag as f64)
}

fn autocorrelation(samples: &[f64], lag: usize) -> f64 {
    let n = samples.len().saturating_sub(lag);
    if n == 0 {
        return 0.0;
    }
    let sum: f64 = (0..n).map(|i| samples[i] * samples[i + lag]).sum();
    sum / n as f64
}
