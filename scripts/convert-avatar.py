"""Converts a Microsoft Rocketbox avatar (FBX + TGA textures) to a compact GLB.

    blender --background --python scripts/convert-avatar.py -- <avatar dir> <out.glb> [texture size]

<avatar dir> holds the Export/*.fbx files and a Textures/ folder. The facial FBX (shape keys)
is preferred when present. Textures are rebuilt from file names, since the FBX references
3ds Max paths: *_color -> base colour, *_normal -> normal map, *_opacity_color -> alpha
(hair). Images are downsized to <texture size> (default 1024) and written as JPEG, PNG
where alpha is needed. Rig and shape keys are kept; no Draco (the client does not ship
the decoder yet).
"""
import glob
import os
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1 :]
avatar_dir, out_path = args[0], args[1]
tex_size = int(args[2]) if len(args) > 2 else 1024

def find_fbx(pattern):
    return sorted(glob.glob(os.path.join(avatar_dir, "Export", pattern))) or sorted(glob.glob(os.path.join(avatar_dir, pattern)))


fbx = find_fbx("*_facial.fbx") or find_fbx("*.fbx")
if not fbx:
    sys.exit(f"no FBX under {avatar_dir} or {avatar_dir}/Export")
fbx = fbx[0]
textures = {os.path.basename(p).lower(): p for p in glob.glob(os.path.join(avatar_dir, "Textures", "*.tga"))}
print(f"[convert] {fbx}")
print(f"[convert] textures: {sorted(textures)}")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=fbx, use_image_search=False, ignore_leaf_bones=True, automatic_bone_orientation=False)

images = {}


def image_for(name):
    """Loads a TGA once, downsized, and returns the bpy image."""
    if name in images:
        return images[name]
    img = bpy.data.images.load(textures[name])
    if max(img.size) > tex_size:
        img.scale(tex_size, tex_size)
    images[name] = img
    return img


def pick(prefix_hint, kind):
    """Finds the texture for a material: kind is 'color', 'normal' or 'opacity_color'."""
    # Material names in Rocketbox FBX are like "f001_body", "m005_head", "hair"; try the
    # material's own words first, then anything of that kind.
    for key in textures:
        if prefix_hint in key and key.endswith(f"_{kind}.tga"):
            return key
    for key in textures:
        if key.endswith(f"_{kind}.tga"):
            return key
    return None


for mat in bpy.data.materials:
    words = [w for w in mat.name.lower().replace("-", "_").split("_") if w]
    hint = "body"
    for w in ("head", "body", "hair", "eye", "opacity"):
        if w in words:
            hint = "head" if w in ("eye",) else w
            break
    print(f"[convert] material {mat.name!r} -> hint {hint!r}")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = 0.6
    if hint == "hair":
        color_key, alpha_key = pick("opacity", "color"), pick("opacity", "color")
    else:
        color_key, alpha_key = pick(hint, "color"), None
    if color_key:
        t = nodes.new("ShaderNodeTexImage")
        t.image = image_for(color_key)
        links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha_key:
            links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
            mat.blend_method = "BLEND"
    normal_key = pick(hint, "normal")
    if normal_key and hint != "hair":
        n = nodes.new("ShaderNodeTexImage")
        n.image = image_for(normal_key)
        n.image.colorspace_settings.name = "Non-Color"
        nm = nodes.new("ShaderNodeNormalMap")
        links.new(n.outputs["Color"], nm.inputs["Color"])
        links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

# Keep only the ARKit shape keys (AK_*): blink, brows, jaw, smile, the 15 visemes' equivalents.
# The FACS (AU_*), Headbox (HB_*), Vive (SR_*) and viseme (AA_VI_*) sets duplicate them and
# were most of a 26 MB file.
for obj in [o for o in bpy.data.objects if o.type == "MESH" and o.data.shape_keys]:
    for kb in list(obj.data.shape_keys.key_blocks):
        if kb.name != "Basis" and not kb.name.startswith("AK_"):
            obj.shape_key_remove(kb)

# Report the rig so the client-side seated pose can be written against real bone names.
for arm in [o for o in bpy.data.objects if o.type == "ARMATURE"]:
    print(f"[convert] armature {arm.name!r} with {len(arm.data.bones)} bones: {[b.name for b in arm.data.bones][:40]}")
for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
    keys = obj.data.shape_keys.key_blocks if obj.data.shape_keys else []
    print(f"[convert] mesh {obj.name!r}: {len(obj.data.vertices)} verts, {len(keys)} shape keys")

os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format="GLB",
    # WebP keeps the hair's alpha and is a fraction of PNG; every browser we target reads it.
    export_image_format="WEBP",
    export_image_quality=80,
    export_jpeg_quality=80,
    export_skins=True,
    export_morph=True,
    export_morph_normal=False,
    export_morph_tangent=False,
    export_animations=False,
    export_yup=True,
    export_apply=False,
)
print(f"[convert] wrote {out_path} ({os.path.getsize(out_path) / 1048576:.1f} MB)")
