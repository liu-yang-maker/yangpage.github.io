#!/usr/bin/env python3
"""
Generate a stylized low-poly PLACEHOLDER character and export it to
    journey3d/public/models/me.glb

Why a placeholder?
------------------
The reference project (dayinji/sen-3d-resume) ships a copyrighted character
model we can't reuse. This script builds a cute, generic low-poly figure so the
whole React Three Fiber pipeline (lighting, gradient background, eye-follow,
orbit) works end-to-end.

Eye-follow convention (matches src/scene/Scene.tsx)
---------------------------------------------------
Meshes whose node name contains "pupil" track the cursor. They are added with a
NODE TRANSFORM (not baked into vertices) so their `position` is readable in
three.js. Keep that convention if you retexture / rebuild.

How to replace with a real model of yourself
--------------------------------------------
1. Turn your cartoon (files/liu_cartoon_*.png) into a .glb via an image-to-3D
   tool (Meshy / Tripo / Rodin), or model one in Blender.
2. Overwrite journey3d/public/models/me.glb with it, then rebuild (npm run build).
3. If your model's eyes aren't named with "pupil", either rename them or change
   the match string in src/scene/Scene.tsx (Character()).

Run:
    pip install trimesh numpy
    python3 journey3d/scripts/make_placeholder_glb.py
"""

import os
import numpy as np
import trimesh

# --- palette (RGBA 0-255) ------------------------------------------------
SKIN = [242, 206, 178, 255]
HOODIE = [43, 49, 66, 255]
PANTS = [33, 37, 48, 255]
SHOE = [20, 22, 28, 255]
EYEWHITE = [248, 248, 250, 255]
PUPIL = [26, 28, 38, 255]
GLASS = [24, 24, 30, 255]
CAP = [38, 42, 58, 255]


def T(x, y, z):
    m = np.eye(4)
    m[:3, 3] = [x, y, z]
    return m


def colored(mesh, rgba):
    mesh.visual.face_colors = np.tile(np.array(rgba, dtype=np.uint8), (len(mesh.faces), 1))
    return mesh


def sphere(radius, color, subdiv=3):
    return colored(trimesh.creation.icosphere(subdivisions=subdiv, radius=radius), color)


def limb(a, b, radius, color, sections=16):
    m = trimesh.creation.cylinder(radius=radius, segment=(np.array(a), np.array(b)), sections=sections)
    return colored(m, color)


def build():
    scene = trimesh.Scene()

    def add(geom, name, transform=None):
        scene.add_geometry(geom, node_name=name, geom_name=name, transform=transform)

    # --- legs / shoes ---
    for side, x in (("L", -0.13), ("R", 0.13)):
        add(limb((x, 0.80, 0), (x, 0.10, 0), 0.115, PANTS), f"leg_{side}")
        shoe = sphere(0.135, SHOE)
        shoe.apply_scale([1.0, 0.7, 1.5])
        shoe.apply_translation([x, 0.06, 0.05])
        add(shoe, f"shoe_{side}")

    # --- pelvis + torso (hoodie) ---
    pelvis = sphere(0.22, PANTS)
    pelvis.apply_translation([0, 0.80, 0])
    add(pelvis, "pelvis")

    torso = limb((0, 0.85, 0), (0, 1.28, 0), 0.27, HOODIE)
    add(torso, "torso")
    shoulders = sphere(0.27, HOODIE)
    shoulders.apply_scale([1.15, 0.7, 0.9])
    shoulders.apply_translation([0, 1.28, 0])
    add(shoulders, "shoulders")

    # --- arms / hands ---
    add(limb((-0.24, 1.26, 0.02), (-0.34, 0.82, 0.05), 0.085, HOODIE), "arm_L")
    add(limb((0.24, 1.26, 0.02), (0.34, 0.82, 0.05), 0.085, HOODIE), "arm_R")
    for side, x in (("L", -0.35), ("R", 0.35)):
        hand = sphere(0.092, SKIN)
        hand.apply_translation([x, 0.78, 0.06])
        add(hand, f"hand_{side}")

    # --- neck + head (skin) ---
    add(limb((0, 1.27, 0), (0, 1.40, 0), 0.085, SKIN), "neck")
    head = sphere(0.30, SKIN, subdiv=3)
    head.apply_scale([1.0, 1.05, 0.98])
    head.apply_translation([0, 1.58, 0])
    add(head, "head")

    # --- ears ---
    for side, x in (("L", -0.29), ("R", 0.29)):
        ear = sphere(0.06, SKIN, subdiv=2)
        ear.apply_translation([x, 1.57, 0])
        add(ear, f"ear_{side}")

    # --- cap: sliced sphere dome + visor ---
    cap = trimesh.creation.icosphere(subdivisions=3, radius=0.325)
    cap.apply_scale([1.0, 1.02, 1.0])
    cap.apply_translation([0, 1.58, 0])
    cap = cap.slice_plane(plane_origin=[0, 1.64, 0], plane_normal=[0, 1, 0])
    colored(cap, CAP)
    add(cap, "cap")
    visor = trimesh.creation.box(extents=[0.40, 0.035, 0.20])
    colored(visor, CAP)
    vt = trimesh.transformations.rotation_matrix(np.deg2rad(-12), [1, 0, 0])
    vt[:3, 3] = [0, 1.66, 0.24]
    visor.apply_transform(vt)
    add(visor, "visor")

    # --- eyes (whites) + glasses (baked), pupils (node transform) ---
    for side, x in (("L", -0.115), ("R", 0.115)):
        eye = sphere(0.072, EYEWHITE, subdiv=2)
        eye.apply_scale([1.0, 1.1, 0.7])
        eye.apply_translation([x, 1.60, 0.245])
        add(eye, f"eye_{side}")

        ring = trimesh.creation.torus(major_radius=0.086, minor_radius=0.013)
        colored(ring, GLASS)
        ring.apply_translation([x, 1.60, 0.255])
        add(ring, f"glasses_{side}")

        # pupil: local geometry + node transform so its position is readable
        pupil = sphere(0.036, PUPIL, subdiv=2)
        add(pupil, f"pupil_{side}", transform=T(x, 1.60, 0.30))

    # glasses bridge
    bridge = trimesh.creation.box(extents=[0.09, 0.014, 0.014])
    colored(bridge, GLASS)
    bridge.apply_translation([0, 1.61, 0.25])
    add(bridge, "bridge")

    # --- eyebrows + subtle smile (skin-dark) ---
    for side, x in (("L", -0.115), ("R", 0.115)):
        brow = trimesh.creation.box(extents=[0.11, 0.02, 0.02])
        colored(brow, [70, 55, 45, 255])
        brow.apply_translation([x, 1.69, 0.27])
        add(brow, f"brow_{side}")

    return scene


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "..", "public", "models")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.normpath(os.path.join(out_dir, "me.glb"))

    scene = build()
    glb = trimesh.exchange.gltf.export_glb(scene)
    with open(out_path, "wb") as f:
        f.write(glb)
    print(f"[make_placeholder_glb] wrote {out_path} ({len(glb)} bytes)")


if __name__ == "__main__":
    main()
