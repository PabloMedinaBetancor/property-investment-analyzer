use std::f64::consts::PI;

/// xoshiro128** seeded by splitmix32. The stream is part of the contract: the TypeScript benchmark kernel reproduces it.
#[derive(Debug, Clone)]
pub struct Rng {
    s: [u32; 4],
}

impl Rng {
    pub fn new(seed: u32) -> Rng {
        let mut state = seed;
        let mut s = [0u32; 4];
        for word in &mut s {
            state = state.wrapping_add(0x9E37_79B9);
            let mut z = state;
            z = (z ^ (z >> 16)).wrapping_mul(0x85EB_CA6B);
            z = (z ^ (z >> 13)).wrapping_mul(0xC2B2_AE35);
            *word = z ^ (z >> 16);
        }
        Rng { s }
    }

    pub fn next_u32(&mut self) -> u32 {
        let [s0, s1, s2, s3] = self.s;
        let result = s1.wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = s1 << 9;
        let s2 = s2 ^ s0;
        let s3 = s3 ^ s1;
        self.s = [s0 ^ s3, s1 ^ s2, s2 ^ t, s3.rotate_left(11)];
        result
    }

    /// Uniform in [0, 1) with 53 random bits, from two outputs.
    pub fn uniform(&mut self) -> f64 {
        let a = self.next_u32();
        let b = self.next_u32();
        ((a >> 5) as f64 * 67_108_864.0 + (b >> 6) as f64) / 9_007_199_254_740_992.0
    }

    /// Box-Muller; `1 - u1` keeps the logarithm finite.
    pub fn normal_pair(&mut self) -> (f64, f64) {
        let u1 = self.uniform();
        let u2 = self.uniform();
        let radius = (-2.0 * libm::log(1.0 - u1)).sqrt();
        let angle = 2.0 * PI * u2;
        (radius * libm::cos(angle), radius * libm::sin(angle))
    }
}

#[cfg(test)]
mod tests {
    use super::Rng;

    #[test]
    fn seed_42_expands_to_the_reference_state() {
        assert_eq!(
            Rng::new(42).s,
            [939_911_724, 3_948_730_756, 321_366_731, 3_317_318_717]
        );
    }
}
