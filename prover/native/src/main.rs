//! Proves one serialized proof preimage with the native prover and prints the time.
//!
//!   prove <preimage file> <keys dir> <zkir dir> <params dir> [repeat]
//!
//! Keys are `<keys dir>/<circuit>.prover` and `.verifier`, the IR `<zkir dir>/<circuit>.zkir`
//! (compactc's JSON), KZG parameters `<params dir>/bls_midnight_2p<k>`; the circuit name is
//! the preimage's own key location. Mirrors what midnight-zkir-wasm does behind `prove()`.
use std::{fs, path::PathBuf, time::Instant};

use rand::rngs::OsRng;
use serialize::{tagged_deserialize, tagged_serialize};
use transient_crypto::proofs::{
    KeyLocation, ParamsProver, ParamsProverProvider, ProofPreimage, ProvingKeyMaterial, Resolver,
};

struct Files {
    keys: PathBuf,
    zkir: PathBuf,
    params: PathBuf,
}

fn read(path: PathBuf) -> std::io::Result<Vec<u8>> {
    fs::read(&path).map_err(|e| std::io::Error::new(e.kind(), format!("{}: {e}", path.display())))
}

impl ParamsProverProvider for Files {
    async fn get_params(&self, k: u8) -> std::io::Result<ParamsProver> {
        let bytes = read(self.params.join(format!("bls_midnight_2p{k}")))?;
        ParamsProver::read(&bytes[..])
    }
}

impl Resolver for Files {
    async fn resolve_key(&self, key: KeyLocation) -> std::io::Result<Option<ProvingKeyMaterial>> {
        let name = key.0.as_ref();
        let prover_key = read(self.keys.join(format!("{name}.prover")))?;
        let verifier_key = read(self.keys.join(format!("{name}.verifier")))?;
        let json = read(self.zkir.join(format!("{name}.zkir")))?;
        let ir = zkir::IrSource::load(&json[..]).map_err(|e| std::io::Error::other(e.to_string()))?;
        let mut ir_source = Vec::new();
        tagged_serialize(&ir, &mut ir_source)?;
        Ok(Some(ProvingKeyMaterial { prover_key, verifier_key, ir_source }))
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 5 {
        eprintln!("usage: prove <preimage file> <keys dir> <zkir dir> <params dir> [repeat]");
        std::process::exit(2);
    }
    let files = Files { keys: args[2].clone().into(), zkir: args[3].clone().into(), params: args[4].clone().into() };
    let repeat: usize = args.get(5).map(|s| s.parse()).transpose()?.unwrap_or(2);

    let bytes = fs::read(&args[1])?;
    let preimage: ProofPreimage = tagged_deserialize(&mut &bytes[..])?;
    println!("{}: preimage {} bytes, {} rayon threads", preimage.key_location.0, bytes.len(), rayon::current_num_threads());
    for i in 0..repeat {
        let t = Instant::now();
        let (proof, _) = futures_executor::block_on(preimage.prove::<zkir::IrSource>(OsRng, &files, &files))?;
        let mut out = Vec::new();
        tagged_serialize(&proof, &mut out)?;
        println!("  proof {} {} bytes in {:.2} s", i + 1, out.len(), t.elapsed().as_secs_f64());
    }
    Ok(())
}
