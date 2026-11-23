# /// script
# requires-python = "==3.12.*"
# dependencies = [
#   "torch==2.7.1", "transformers==4.49.0", "huggingface-hub==0.36.2",
#   "omegaconf==2.3.0", "einops==0.8.2", "imageio==2.38.2", "numpy==1.26.4",
#   "trimesh==5.2.2", "scikit-image==0.26.0", "fast-simplification==0.2.0",
#   "gradio==6.17.3", "httpx[socks]==0.28.1",
# ]
# [tool.uv.sources]
# torch = [{ index = "pytorch-cpu", marker = "sys_platform != 'darwin'" }]
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Local browser workbench for reconstructing one isolated prop with TripoSR."""

import hashlib
import os
import subprocess
import sys
import tarfile
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from uuid import uuid4

os.environ.setdefault("GRADIO_ANALYTICS_ENABLED", "False")

import gradio as gr
import numpy as np
import torch
import trimesh
from PIL import Image, ImageOps
from scipy.ndimage import binary_propagation
from skimage.measure import marching_cubes

HERE = Path(__file__).resolve().parent
CACHE = HERE.parents[1] / ".compact" / "lounge-studio"
SOURCE = "107cefdc244c39106fa830359024f6a2f1c78871"
WEIGHTS = "5b521936b01fbe1890f6f9baed0254ab6351c04a"
DINO = "f205d5d8e640a89a2b8ef0369670dfc37cc07fc2"


def download(name, url, digest):
    path = CACHE / name
    def verified(file):
        with file.open("rb") as data:
            return hashlib.file_digest(data, "sha256").hexdigest() == digest

    if path.is_file() and verified(path):
        return path
    with TemporaryDirectory(dir=CACHE) as tmp:
        part = Path(tmp) / name
        subprocess.run(["curl", "-fLsS", "--retry", "3", "-o", part, url], check=True)
        if not verified(part):
            raise ValueError(f"Checksum failed for {name}")
        part.replace(path)
    return path


def load_model():
    CACHE.mkdir(parents=True, exist_ok=True)
    archive = download("source.tar.gz", f"https://codeload.github.com/VAST-AI-Research/TripoSR/tar.gz/{SOURCE}",
                       "bcb414550dcfcb9f5ea6a7b9c12f2bbff889f5b4a564a493178393360d9034ec")
    base = f"https://huggingface.co/stabilityai/TripoSR/resolve/{WEIGHTS}"
    download("config.yaml", f"{base}/config.yaml", "74ca708ce086bf68e97709ea6b3d91f14717921c04691e84043f0eb8fcc68e62")
    download("model.ckpt", f"{base}/model.ckpt", "429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee")
    vit = download("vit-config.json", f"https://huggingface.co/facebook/dino-vitb16/resolve/{DINO}/config.json",
                   "b87c0270b97db085fd82cf114a761fd0f62ae7914fbd407c752a2260646b689c")

    # Work on a fresh copy of the pinned source. Two optional imports would otherwise
    # require an ONNX matting model and a compiled marching-cubes extension.
    with TemporaryDirectory(dir=CACHE) as tmp:
        root = f"TripoSR-{SOURCE}"
        with tarfile.open(archive) as bundle:
            files = [f for f in bundle if f.name.startswith(f"{root}/tsr/") or f.name == f"{root}/LICENSE"]
            bundle.extractall(tmp, members=files, filter="data")
        src = Path(tmp) / root
        utils = src / "tsr/utils.py"
        utils.write_text(utils.read_text()
                         .replace("\nimport rembg\n", "\n")
                         .replace("        image = rembg.remove", "        import rembg\n        image = rembg.remove"))
        system = src / "tsr/system.py"
        import_cubes = "from .models.isosurface import MarchingCubeHelper"
        use_cubes = "        self.isosurface_helper = MarchingCubeHelper(resolution)"
        system.write_text(system.read_text().replace(import_cubes + "\n", "")
                          .replace(use_cubes, f"        {import_cubes}\n{use_cubes}"))
        sys.path.insert(0, str(src))
        from tsr.system import TSR
        from tsr.models.tokenizers import image as tokenizer
        from tsr.utils import to_gradio_3d_orientation
        with patch.object(tokenizer, "hf_hub_download", return_value=str(vit)):
            model = TSR.from_pretrained(str(CACHE), "config.yaml", "model.ckpt").eval()
    model.renderer.set_chunk_size(16384)
    return model, to_gradio_3d_orientation


def prepare(image):
    image = ImageOps.exif_transpose(image).convert("RGBA")
    image = ImageOps.pad(image, (512, 512), method=Image.Resampling.BICUBIC, color=(255, 255, 255, 0))
    pixels = np.array(image)
    # Remove white connected to the outside, preserving white details inside the object.
    empty = (pixels[:, :, 3] == 0) | (pixels[:, :, :3].min(axis=2) > 227)
    edges = np.zeros_like(empty)
    edges[[0, -1], :] = edges[:, [0, -1]] = True
    pixels[:, :, 3][binary_propagation(edges & empty, mask=empty)] = 0
    if not pixels[:, :, 3].any():
        raise gr.Error("The image is empty. Try a single prop on a transparent or white background.")
    result = Image.new("RGB", (576, 576), (128, 128, 128))
    result.paste(image.convert("RGB"), (32, 32), Image.fromarray(pixels[:, :, 3]))
    return result


@torch.inference_mode()
def reconstruct(model, orient, image, triangle_budget=2400):
    if image is None:
        raise gr.Error("Choose a reference image first.")
    code = model(prepare(image), device="cpu")[0]
    radius = model.renderer.cfg.radius
    axis = torch.linspace(-radius, radius, 128)
    points = torch.stack(torch.meshgrid(axis, axis, axis, indexing="ij"), -1).reshape(-1, 3)

    def field(x, name):
        return model.renderer.query_triplane(model.decoder, x, code)[name]

    density = torch.cat([field(chunk, "density_act").flatten() for chunk in points.split(16384)])
    if not density.min() < 25 < density.max():
        raise gr.Error("No surface found. Crop to a single object and try again.")
    vertices, faces, _, _ = marching_cubes(density.reshape(128, 128, 128).numpy(), level=25)
    mesh = trimesh.Trimesh(vertices=vertices * (2 * radius / 127) - radius, faces=faces)
    mesh = max(mesh.split(only_watertight=False), key=lambda part: part.area)
    if mesh.volume < 0:
        mesh.invert()
    if len(mesh.faces) > triangle_budget:
        mesh = mesh.simplify_quadric_decimation(face_count=triangle_budget)
    srgb = field(torch.tensor(mesh.vertices, dtype=torch.float32), "color").clamp(0, 1).numpy()
    linear = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
    mesh.visual.vertex_colors = (linear * 255).round().astype(np.uint8)
    orient(mesh)
    mesh.vertices -= mesh.bounds.mean(axis=0)
    mesh.apply_scale(0.56 / mesh.extents[1])
    return mesh


if __name__ == "__main__":
    torch.set_num_threads(min(6, os.cpu_count() or 1))
    model, orient = load_model()
    with TemporaryDirectory(dir=CACHE) as output:
        def generate(image, triangle_budget=2400):
            path = Path(output) / f"prop-{uuid4().hex}.glb"
            reconstruct(model, orient, image, int(triangle_budget)).export(path)
            return str(path), str(path)

        workbench = gr.Interface(
            generate,
            [gr.Image(label="Reference image", value=str(HERE / "sconce.webp"), image_mode="RGBA", type="pil", sources=["upload"]),
             gr.Slider(800, 6000, value=2400, step=200, label="Triangle budget")],
            [gr.Model3D(label="Reconstructed prop"), gr.DownloadButton("Download GLB")],
            title="Dust Poker prop studio",
            description="Choose a single prop on a white or transparent background. Generate a mesh, rotate it, and download the GLB.",
            examples=[[str(HERE / f"{prop}.webp"), budget]
                      for prop, budget in (("sconce", 2400), ("jukebox", 2400), ("falcon", 1600))],
            cache_examples=False,
            flagging_mode="never", submit_btn="Generate prop", api_name="reconstruct", analytics_enabled=False,
        )
        workbench.queue(default_concurrency_limit=1).launch(server_name="127.0.0.1", share=False)
