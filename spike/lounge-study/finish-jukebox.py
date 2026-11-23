# /// script
# requires-python = "==3.12.*"
# dependencies = ["numpy==1.26.4", "pillow==12.3.0", "scipy==1.17.1", "trimesh==5.2.2"]
# ///
"""Dress the studio's exported jukebox mesh and set its origin on the floor."""

import argparse
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image
from scipy.ndimage import binary_propagation, distance_transform_edt
from scipy.spatial import cKDTree
from trimesh.visual import TextureVisuals
from trimesh.visual.material import PBRMaterial


def cabinet_art(reference):
    rgb = np.array(Image.open(reference).convert("RGB"))
    white = rgb.min(axis=2) > 225
    border = np.zeros_like(white)
    border[[0, -1], :] = border[:, [0, -1]] = True
    background = binary_propagation(border & white, mask=white)
    bounds = Image.fromarray(~background).getbbox()
    # Extend the cabinet colours into the UV margins to keep white out of the mips.
    nearest = distance_transform_edt(background, return_distances=False, return_indices=True)
    rgb = rgb[tuple(nearest)]
    front = Image.fromarray(rgb).crop(bounds)
    # Only the glass arch and the amber changer window are wired for illumination.
    hue, sat, value = np.asarray(front.convert("HSV")).transpose(2, 0, 1)
    y, x = np.mgrid[0:front.height, 0:front.width]
    x, y = x / front.width, y / front.height
    surround = (y < 0.765) & ((x < 0.135) | ((x > 0.765) & (x < 0.915)) | (y < 0.19))
    window = ((x - 0.45) / 0.215) ** 2 + ((y - 0.27) / 0.15) ** 2 < 1
    glass = (hue > 11) & (hue < 73) & (sat > 45)
    intensity = np.clip((value.astype(float) - 100) / 145, 0, 1)
    glow = intensity * glass * np.maximum(surround, window * 0.55)
    emission = Image.fromarray((np.asarray(front) * glow[:, :, None]).astype(np.uint8))
    emission.thumbnail((320, 512), Image.Resampling.LANCZOS)
    emission.format = "JPEG"
    unlit = Image.fromarray((np.asarray(front) * (1 - 0.82 * glow[:, :, None])).astype(np.uint8))
    unlit.format = "JPEG"
    return unlit, emission


def finish(raw, reference, output):
    mesh = trimesh.load_mesh(raw)
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.remove_unreferenced_vertices()
    low, high = mesh.bounds
    # TripoSR's reference camera faces +Z. X runs right-to-left in this view.
    facing = mesh.face_normals[:, 2] < -0.18
    face = mesh.submesh([facing], append=True)
    body = mesh.submesh([~facing], append=True)
    uv = (face.vertices[:, :2] - low[:2]) / (high[:2] - low[:2])
    uv[:, 0] = 1 - uv[:, 0]
    front, glow = cabinet_art(reference)
    face.visual = TextureVisuals(uv=uv, material=PBRMaterial(
        name="Illuminated glass and grille", baseColorTexture=front, emissiveTexture=glow,
        emissiveFactor=[1, 1, 1], metallicFactor=0.16, roughnessFactor=0.43))
    # The studio reference shows the front. Wrap the unseen cabinet in the bar's walnut.
    wood_path = Path(__file__).resolve().parents[2] / "src/assets/textures/Wood066/Color.jpg"
    wood = Image.open(wood_path).convert("RGB").resize((256, 256), Image.Resampling.LANCZOS)
    wood.format = "JPEG"
    x, y, z = body.vertices.T
    body_uv = np.column_stack((np.arctan2(x, z) / np.pi, (y - low[1]) / (high[1] - low[1])))
    body.visual = TextureVisuals(uv=body_uv, material=PBRMaterial(
        name="Walnut veneer", baseColorTexture=wood, baseColorFactor=[0.39, 0.22, 0.12, 1.0],
        metallicFactor=0.0, roughnessFactor=0.37))

    # Smooth across the material boundary and orient the finished cabinet toward +Z.
    good = np.linalg.norm(mesh.vertex_normals, axis=1) > 0.99
    neighbours = cKDTree(mesh.vertices[good])
    scene = trimesh.Scene()
    for name, part in [("Cabinet", body), ("Front", face)]:
        _, indices = neighbours.query(part.vertices)
        part.vertex_normals = mesh.vertex_normals[good][indices]
        part.apply_translation([0, -low[1], 0])
        part.apply_scale(1.54 / (high[1] - low[1]))
        part.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [0, 1, 0]))
        scene.add_geometry(part, node_name=name, geom_name=name)
    scene.export(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mesh", type=Path, help="GLB exported by the prop studio")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    finish(args.mesh, Path(__file__).with_name("jukebox.webp"), args.output)
