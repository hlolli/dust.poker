# /// script
# requires-python = "==3.12.*"
# dependencies = ["numpy==1.26.4", "pillow==12.3.0", "trimesh==5.2.2"]
# ///
"""Mount the studio falcon on a tabletop dealer button, in metres and Y-up."""

import argparse
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont
from trimesh.visual import TextureVisuals
from trimesh.visual.material import PBRMaterial


def collar():
    # The inscription repeats around the edge so it reads from all six seats.
    strip = Image.new("RGB", (768, 72), "#ede0b8")
    ink = ImageDraw.Draw(strip)
    font = ImageFont.load_default(size=43)
    for x in (128, 384, 640):
        ink.text((x, 36), "DEALER", fill="#183b34", font=font, anchor="mm", stroke_width=1)
        ink.polygon([(x-122, 36), (x-116, 29), (x-110, 36), (x-116, 43)], fill="#97681f")
    strip.format = "PNG"
    material = PBRMaterial(name="Printed ivory band", baseColorTexture=strip, metallicFactor=0.06, roughnessFactor=0.5)

    steps = 64
    vertices, faces, uv = [], [], []
    for i in range(steps + 1):
        theta = 2 * np.pi * i / steps
        for radius, y, v in [(0.04, 0.002, 0), (0.029, 0.016, 1)]:
            vertices.append([radius * np.sin(theta), y, radius * np.cos(theta)])
            uv.append([i / steps, v])
        if i < steps:
            j = i * 2
            faces.extend([(j, j+2, j+1), (j+2, j+3, j+1)])
    return trimesh.Trimesh(vertices, faces, visual=TextureVisuals(uv=uv, material=material), process=False)


def finish(raw, output):
    scene = trimesh.Scene()
    bird = trimesh.load_mesh(raw)
    bird.update_faces(bird.nondegenerate_faces())
    bird.remove_unreferenced_vertices()
    bird.apply_translation([0, -bird.bounds[0, 1], 0])
    bird.apply_scale(0.066 / bird.extents[1])
    bird.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [0, 1, 0]))
    bird.apply_translation([0, 0.017, 0])
    colors = bird.visual.vertex_colors.copy()
    # The neural colour contains studio shadows. Give the brass its own albedo
    # before lighting it again under the table lamp; keep the green stone base.
    stone = colors[:, 1].astype(float) > colors[:, 0] * 1.04
    colors[~stone, :3] = 0.45 * colors[~stone, :3] + 0.55 * np.array([190, 132, 61])
    bird.visual = TextureVisuals(material=PBRMaterial(name="Cast falcon", metallicFactor=0.38, roughnessFactor=0.41))
    bird.visual.vertex_attributes["color"] = colors
    normals = bird.vertex_normals.copy()
    good = np.linalg.norm(normals, axis=1) > 0.99
    for i in np.flatnonzero(~good):
        closest = np.argmin(np.linalg.norm(bird.vertices[good] - bird.vertices[i], axis=1))
        normals[i] = normals[good][closest]
    bird.vertex_normals = normals
    scene.add_geometry(bird, node_name="Falcon", geom_name="Falcon")

    # The lips cover both ends of the printed sleeve. The lower one rests on the felt.
    lips = []
    for radius, height in [(0.0405, 0.001), (0.0295, 0.017)]:
        lip = trimesh.creation.cylinder(radius=radius, height=0.002, sections=64)
        lip.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
        lip.apply_translation([0, height, 0])
        lips.append(lip)
    brass = trimesh.util.concatenate(lips)
    brass.visual = TextureVisuals(material=PBRMaterial(
        name="Turned brass", baseColorFactor=[0.66, 0.41, 0.15, 1.0], metallicFactor=0.71, roughnessFactor=0.35))
    scene.add_geometry(brass, node_name="Bezel", geom_name="Bezel")
    scene.add_geometry(collar(), node_name="Inscription", geom_name="Inscription")
    scene.export(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mesh", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    finish(args.mesh, args.output)
