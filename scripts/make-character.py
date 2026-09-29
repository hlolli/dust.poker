"""Builds one of dust.poker's own characters with MPFB (MakeHuman for Blender) and writes it as a GLB.

    blender --background --python scripts/make-character.py -- <name> <out.glb>
    scripts/make-characters.sh            # every character in CAST, into src/assets/characters/

Needs the MPFB extension and these CC0 asset packs installed in it: makehuman_system_assets,
skins01, skins02, suits01, dress01, shoes01, faceunits01 (static.makehumancommunity.org/assets/assetpacks.html).
MakeHuman's output is CC0; so are those packs, so the GLBs are too (LICENSES.md).

What the game expects of a character, and this script makes so:
- the rig's bones carry the 3ds Max Biped names the poses use ("Bip01 L Thigh", ...);
- the 52 ARKit face shapes as shape keys named as ARKit names them, capitalised ("EyeBlinkLeft");
- materials named by role, which the game reads by suffix: `_skin` (tinted by the creator's skin
  slider), `_outfit` (the main garment, recoloured by the outfit choice), `_clothes` (kept as
  they are), `_opacity` (hair, brows, lashes: cut out by alpha), `_eyes`;
- textures at most 1024 pixels, as WebP; the character faces +z (Blender's -y) with feet at 0.
"""

import os
import sys

import bpy
from bl_ext.blender_org.mpfb.services import AssetService, ExportService, FaceService, HumanService, ObjectService, TargetService
from bl_ext.blender_org.mpfb.services.faceservice import ARKIT_FACEUNITS

# The cast: a 1960s Las Vegas card room. Macro sliders are MakeHuman's (0 to 1; age 0.5 is 25
# years, 1 is 90; gender 0 female, 1 male). `outfit` is the garment the outfit colour recolours.
# `hair_colour` tints hair and brows: MakeHuman's hair textures are near white, to be coloured.
CAST = {
    "frank": dict(hair_colour="#4a3e34", label="Man in a dinner jacket", gender=1, age=0.68, muscle=0.55, weight=0.6, height=0.55, race=(0, 0, 1),
                  skin="middleage_caucasian_male", eyes="blue", brows="eyebrow001", lashes="eyelashes02", hair="short02",
                  outfit="toigo_suit_with_dinner_jacket", clothes=["shoes04"]),
    "dean": dict(hair_colour="#2a1c12", label="Man in a grey suit", gender=1, age=0.6, muscle=0.5, weight=0.5, height=0.6, race=(0, 0.1, 0.9),
                 skin="young_caucasian_male", eyes="brown", brows="eyebrow003", lashes="eyelashes02", hair="short03",
                 outfit="male_elegantsuit01", clothes=["shoes04"]),
    "sammy": dict(hair_colour="#141010", label="Man in a suit and tie", gender=1, age=0.55, muscle=0.55, weight=0.45, height=0.5, race=(1, 0, 0),
                  skin="young_african_male", eyes="brown", brows="eyebrow006", lashes="eyelashes02", hair="short01",
                  outfit="toigo_male_suit_tie_and_jacket", clothes=["shoes04"]),
    "louis": dict(hair_colour="#9a9894", label="Man in a double-breasted suit", gender=1, age=0.8, muscle=0.45, weight=0.65, height=0.45, race=(0.9, 0, 0.1),
                  skin="old_african_male", eyes="brownlight", brows="eyebrow009", lashes="eyelashes01", hair="short04",
                  outfit="toigo_male_double-breasted_suit", clothes=["shoes04"]),
    "tony": dict(hair_colour="#121010", label="Man in a three-piece suit", gender=1, age=0.66, muscle=0.5, weight=0.55, height=0.5, race=(0, 0.9, 0.1),
                 skin="middleage_asian_male", eyes="brown", brows="eyebrow004", lashes="eyelashes01", hair="short02",
                 outfit="toigo_male_suit_3", clothes=["shoes04"]),
    "peggy": dict(hair_colour="#d8b26a", label="Woman in a halter dress", gender=0, age=0.55, muscle=0.4, weight=0.45, height=0.5, race=(0, 0, 1),
                  skin="young_caucasian_female", eyes="bluegreen", brows="eyebrow010", lashes="eyelashes03", hair="bob01",
                  outfit="toigo_halter_dress_midi", clothes=["toigo_flats"]),
    "ella": dict(hair_colour="#1a1210", label="Woman in a shift dress", gender=0, age=0.64, muscle=0.45, weight=0.5, height=0.55, race=(1, 0, 0),
                 skin="middleage_african_female", eyes="brown", brows="eyebrow011", lashes="eyelashes04", hair="bob02",
                 outfit="toigo_shift_dress", clothes=["cortu_t-bar"]),
    "grace": dict(hair_colour="#0e0b0a", label="Woman in a full-skirted dress", gender=0, age=0.52, muscle=0.4, weight=0.4, height=0.45, race=(0, 1, 0),
                  skin="young_asian_female", eyes="brown", brows="eyebrow012", lashes="eyelashes03", hair="long01",
                  outfit="toigo_camisole_dress_with_full_skirt", clothes=["toigo_ballet_flats_with_bows"]),
    # The house: the dealer in a bow tie, the bartender likewise.
    "dealer": dict(hair_colour="#2a1c12", label="Dealer", gender=1, age=0.58, muscle=0.5, weight=0.5, height=0.55, race=(0, 0.2, 0.8),
                   skin="young_caucasian_male2", eyes="grey", brows="eyebrow002", lashes="eyelashes01", hair="short01",
                   outfit="toigo_suit_with_jacket_and_bowtie", clothes=["shoes04"]),
    "bartender": dict(hair_colour="#6a6058", label="Bartender", gender=1, age=0.7, muscle=0.55, weight=0.6, height=0.5, race=(0.3, 0, 0.7),
                      skin="middleage_caucasian_male", eyes="green", brows="eyebrow007", lashes="eyelashes01", hair="short04",
                      outfit="toigo_suit_with_jacket_and_bowtie", clothes=["shoes04"]),
}

# The game-engine rig's bones, by the Biped names the game's poses use.
BIPED = {
    "Root": "Bip01", "pelvis": "Bip01 Pelvis", "spine_01": "Bip01 Spine", "spine_02": "Bip01 Spine1", "spine_03": "Bip01 Spine2",
    "neck_01": "Bip01 Neck", "head": "Bip01 Head",
}
for side, s in (("l", "L"), ("r", "R")):
    BIPED.update({
        f"clavicle_{side}": f"Bip01 {s} Clavicle", f"upperarm_{side}": f"Bip01 {s} UpperArm", f"lowerarm_{side}": f"Bip01 {s} Forearm",
        f"hand_{side}": f"Bip01 {s} Hand", f"thigh_{side}": f"Bip01 {s} Thigh", f"calf_{side}": f"Bip01 {s} Calf",
        f"foot_{side}": f"Bip01 {s} Foot", f"ball_{side}": f"Bip01 {s} Toe0",
    })
    for n, finger in enumerate(["thumb", "index", "middle", "ring", "pinky"]):
        for k in (1, 2, 3):
            BIPED[f"{finger}_0{k}_{side}"] = f"Bip01 {s} Finger{n}" + ("" if k == 1 else str(k - 1))


def say(*a):
    print("[character]", *a, flush=True)


def asset(fragment, subdir):
    path = AssetService.find_asset_absolute_path(fragment, asset_subdir=subdir)
    if not path:
        raise RuntimeError(f"no {subdir} asset {fragment!r}; is its pack installed?")
    return path


def mhclo(name, subdir):
    return asset(f"{name}/{name}.mhclo", subdir)


def uuid_of(mhclo_path):
    with open(mhclo_path) as f:
        for line in f:
            if line.startswith("uuid "):
                return line.split()[1]
    return None


def build(spec):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    african, asian, caucasian = spec["race"]
    macro = TargetService.get_default_macro_info_dict()
    macro.update(gender=spec["gender"], age=spec["age"], muscle=spec["muscle"], weight=spec["weight"], height=spec["height"])
    macro["race"] = {"african": african, "asian": asian, "caucasian": caucasian}
    basemesh = HumanService.create_human(macro_detail_dict=macro)
    HumanService.add_builtin_rig(basemesh, "game_engine")
    HumanService.set_character_skin(asset(f"{spec['skin']}/{spec['skin']}.mhmat", "skins"), basemesh, skin_type="GAMEENGINE")
    eyes = mhclo("low-poly", "eyes")
    HumanService.add_mhclo_asset(eyes, basemesh, asset_type="Eyes", subdiv_levels=0, material_type="GAMEENGINE",
                                 alternative_materials={uuid_of(eyes): f"materials/{spec['eyes']}.mhmat"})
    for kind, subdir, name in (("Eyebrows", "eyebrows", spec["brows"]), ("Eyelashes", "eyelashes", spec["lashes"]), ("Hair", "hair", spec["hair"])):
        HumanService.add_mhclo_asset(mhclo(name, subdir), basemesh, asset_type=kind, subdiv_levels=0, material_type="GAMEENGINE")
    for name in [spec["outfit"], *spec["clothes"]]:
        HumanService.add_mhclo_asset(mhclo(name, "clothes"), basemesh, asset_type="Clothes", subdiv_levels=0, material_type="GAMEENGINE")
    return basemesh


def export_copy(basemesh):
    """MPFB's own export copy: body shape baked in, the face units loaded and spread to the other meshes, helpers gone."""
    copy = ExportService.create_character_copy(basemesh, name_suffix="_export")
    new_basemesh = ObjectService.find_object_of_type_amongst_nearest_relatives(copy)
    TargetService.bake_targets(new_basemesh)
    FaceService.load_targets(new_basemesh, load_microsoft_visemes=False, load_meta_visemes=False, load_arkit_faceunits=True)
    FaceService.interpolate_targets(new_basemesh)
    ExportService.bake_modifiers_remove_helpers(new_basemesh, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=True)
    return copy


def role(obj, spec):
    """What the game does with this mesh's material, by what MPFB made it for."""
    kind = ObjectService.get_object_type(obj)
    if kind == "Basemesh":
        return "skin"
    if kind in ("Eyebrows", "Eyelashes", "Hair"):
        return "opacity"
    if kind == "Eyes":
        return "eyes"
    return "outfit" if obj.name.startswith(spec["outfit"]) or spec["outfit"] in obj.name else "clothes"


def colour_image(material, hex_colour):
    """Dyes the material's base colour texture: each strand keeps its brightness relative to the
    texture's average, and the average becomes the colour. MakeHuman's hair textures come near
    white or already dark; a plain multiply could darken them but never lighten them to blonde."""
    import numpy as np
    rgb = np.array([int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)], dtype=np.float32)
    seen = set()
    for node in material.node_tree.nodes:
        if node.type != "TEX_IMAGE" or not node.image or node.image.name in seen or node.image.colorspace_settings.name == "Non-Color":
            continue
        seen.add(node.image.name)
        px = np.array(node.image.pixels[:], dtype=np.float32).reshape(-1, 4)
        lum = px[:, :3] @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
        seen_strands = px[:, 3] > 0.5
        mean = float(lum[seen_strands].mean()) if seen_strands.any() else 1.0
        px[:, :3] = rgb[None, :] * np.clip(lum / max(mean, 1e-3), 0, 2.2)[:, None]
        node.image.pixels = np.clip(px, 0, 1).ravel().tolist()
        node.image.update()


def prepare(rig, meshes, name, spec):
    for bone in rig.data.bones:
        if bone.name in BIPED:
            bone.name = BIPED[bone.name]  # Blender renames the meshes' vertex groups with it
    # ARKit writes "eyeBlinkLeft"; the game reads "EyeBlinkLeft", as Rocketbox named them.
    arkit = {n: n[0].upper() + n[1:] for n in ARKIT_FACEUNITS}
    for obj in meshes:
        keys = obj.data.shape_keys
        if keys:
            for kb in list(keys.key_blocks):
                if kb == keys.reference_key:
                    continue
                bare = next((n for n in arkit if kb.name.endswith(n)), None)  # MPFB may prefix what it loads
                if bare:
                    kb.name = arkit[bare]
                else:
                    obj.shape_key_remove(kb)
        r = role(obj, spec)
        tint = None if r != "opacity" or ObjectService.get_object_type(obj) == "Eyelashes" else spec["hair_colour"]
        part = ObjectService.get_object_type(obj).lower() if r != "clothes" else obj.name.split(".")[-1].removesuffix("_export")
        for slot in obj.material_slots:
            if slot.material:
                # Unique per mesh, ending in the role: "frank_hair_opacity", "frank_shoes02_clothes", "frank_basemesh_skin".
                slot.material.name = f"{name}_{part}_{r}"
                for node in slot.material.node_tree.nodes:
                    if node.type == "TEX_IMAGE" and node.image and max(node.image.size) > 1024:
                        w, h = node.image.size
                        k = 1024 / max(w, h)
                        node.image.scale(max(1, int(w * k)), max(1, int(h * k)))
                    if node.type == "BSDF_PRINCIPLED" and r != "opacity":
                        # Opaque: MPFB wires every texture's alpha through, and a blended skin draws
                        # the inside of the mouth and the eye sockets through the face.
                        for link in list(node.inputs["Alpha"].links):
                            slot.material.node_tree.links.remove(link)
                        node.inputs["Alpha"].default_value = 1.0
                if tint:
                    colour_image(slot.material, tint)


def split_head(body, name):
    """Cuts the head and neck off the body into a mesh of its own, `<name>_head`, same material
    and face shapes. A first-person player's own head is then hidden whole: collapsing its bone
    instead drew the inside of the neck and collar into the camera when looking down."""
    groups = {g.index for g in body.vertex_groups if g.name in ("Bip01 Head", "Bip01 Neck")}
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    for v in body.data.vertices:
        v.select = sum(g.weight for g in v.groups if g.group in groups) > 0.5
    for p in body.data.polygons:
        p.select = all(body.data.vertices[i].select for i in p.vertices)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    head = next(o for o in bpy.context.selected_objects if o is not body)
    head.name = head.data.name = f"{name}_head"
    return head


def main():
    args = sys.argv[sys.argv.index("--") + 1:]
    name, out = args[0], args[1]
    spec = CAST[name]
    say("building", name, "-", spec["label"])
    basemesh = build(spec)
    copy = export_copy(basemesh)
    rig = copy if copy.type == "ARMATURE" else ObjectService.find_object_of_type_amongst_nearest_relatives(copy, "Skeleton")
    meshes = [o for o in rig.children if o.type == "MESH"]
    prepare(rig, meshes, name, spec)
    body = next(o for o in meshes if ObjectService.get_object_type(o) == "Basemesh")
    meshes.append(split_head(body, name))
    for obj in meshes:
        keys = obj.data.shape_keys
        say("mesh", obj.name, ObjectService.get_object_type(obj), len(obj.data.vertices), "verts,",
            len(keys.key_blocks) - 1 if keys else 0, "shape keys,", [s.material.name for s in obj.material_slots if s.material])
    say("bones", len(rig.data.bones), sorted(b.name for b in rig.data.bones if b.name.startswith("Bip01"))[:12])
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_image_format="WEBP",
        export_image_quality=80,
        export_skins=True,
        export_morph=True,
        export_morph_normal=False,
        export_morph_tangent=False,
        export_try_sparse_sk=True,
        export_animations=False,
        export_apply=False,
        export_yup=True,
    )
    say("wrote", out, os.path.getsize(out) // 1024, "KB")


main()
