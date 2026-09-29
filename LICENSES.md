# Third-party assets

Code in this repository is MIT (see LICENSE). Bundled assets and their licences:

## Textures (src/assets/textures/)

All from [ambientCG](https://ambientcg.com), licensed [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Downloaded 2026-09-15 as the 1K JPG sets; only the Color, NormalGL, Roughness and (where present) Metalness maps are kept.

| Folder | Source |
| --- | --- |
| Marble006 | https://ambientcg.com/a/Marble006 |
| Marble012 | https://ambientcg.com/a/Marble012 |
| Wood066 | https://ambientcg.com/a/Wood066 |
| Fabric030 | https://ambientcg.com/a/Fabric030 |
| Leather011 | https://ambientcg.com/a/Leather011 |
| Metal032 | https://ambientcg.com/a/Metal032 |
| Plaster001 | https://ambientcg.com/a/Plaster001 |
| Carpet013 | https://ambientcg.com/a/Carpet013 |

## Characters (src/assets/characters/)

Our own, built by `scripts/make-character.py` with [MPFB](https://extensions.blender.org/add-ons/mpfb/) (MakeHuman for Blender; the add-on is GPL-3.0, what it makes is CC0) from these CC0 asset packs of the [MakeHuman community](http://static.makehumancommunity.org/assets/assetpacks.html):

| Pack | What it gave | Licence |
| --- | --- | --- |
| makehuman_system_assets | body, rig, eyes, brows, lashes, hair, shoes, some suits | CC0 |
| skins01, skins02 | skin textures | CC0 |
| suits01 | dinner jacket, bow-tie, double-breasted and three-piece suits (Margaret Toigo) | CC0 |
| dress01 | halter, shift and full-skirted dresses (Margaret Toigo) | CC0 |
| shoes01 | the women's flats and T-bar shoes (Margaret Toigo, Cortu) | CC0 |
| faceunits01 | the 52 ARKit face shapes (Mika Suominen) | CC0 |

The GLBs are CC0 in turn. The packs are not in this repository; `make-character.py` names what it needs.

## Avatars (src/assets/avatars/)

No longer in the game: the room and the creator use the characters above.

From the [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox), MIT License, Copyright (c) Microsoft Corporation. Converted from the library's FBX and TGA sources to GLB with 1K JPEG textures by `scripts/convert-avatar.py` (Blender); rig and facial shape keys kept. Characters used: Business_Male_01, Business_Male_02 (bartender), Business_Male_04, Business_Male_06, Business_Female_02, Female_Party_01, Female_Party_02. If you use the library in research, its authors ask for a citation: Gonzalez-Franco et al., "The Rocketbox library and the utility of freely available rigged avatars", Frontiers in Virtual Reality, 2020.

## Fonts

The menu and the action bar load Limelight, Yellowtail and Cormorant Garamond from Google Fonts at run time (`src/index.html`); nothing is shipped in the repo. All three are under the SIL Open Font License 1.1. The 3D labels use system fonts.

## Contracts and prover

`spike/compact-browser/contract/` is midnight-js's precompiled counter contract, Apache-2.0, Copyright Midnight Foundation. The prover built by `scripts/build-prover.sh` and `scripts/build-prover-mt.sh` is compiled from `github.com/midnightntwrk/midnight-zkir` (Apache-2.0) and is not committed.
