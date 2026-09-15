//! Midnight's wasm prover with a rayon thread pool. Call `initThreadPool(n)` from JS
//! before proving; everything else is re-exported unchanged from midnight-zkir-wasm.
pub use wasm_bindgen_rayon::init_thread_pool;
pub use zkir::*;

/// Diagnostic: how many rayon threads does this build see, and does `par_iter` spread work?
/// Returns [current_num_threads, elapsed_ms] for a fixed CPU-bound workload of `n` chunks.
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn rayon_probe(n: u32) -> Vec<f64> {
    use rayon::prelude::*;
    let start = js_sys::Date::now();
    let total: u64 = (0..n)
        .into_par_iter()
        .map(|i| {
            let mut x: u64 = i as u64 + 1;
            for _ in 0..20_000_000u32 {
                x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            }
            x & 1
        })
        .sum();
    let elapsed = js_sys::Date::now() - start;
    vec![rayon::current_num_threads() as f64, elapsed, total as f64]
}
