# Material PBR textures

Put each image in the matching material folder. Supported material keys are
`concrete`, `steel`, `rubber`, `glass`, `aluminum`, `brick`, and `timber`.
Texture filenames can include extra prefixes and resolution suffixes, for
example:

```text
src/assets/materials/brick/red_brick_diff_1k.jpg
src/assets/materials/brick/red_brick_nor_gl_1k.jpg
src/assets/materials/brick/red_brick_rough_1k.jpg
src/assets/materials/brick/red_brick_arm_1k.jpg
src/assets/materials/brick/red_brick_ao_1k.jpg
src/assets/materials/brick/red_brick_disp_1k.png
src/assets/materials/concrete/gravel_concrete_03_diff_1k.jpg
src/assets/materials/rubber/rubber_tiles_nor_gl_1k.jpg
src/assets/materials/steel/blue_metal_plate_diff_1k.jpg
src/assets/materials/timber/hinoki_planks_diff_1k.jpg
src/assets/materials/steel/blue_metal_plate_nor_gl_1k.jpg
src/assets/materials/steel/blue_metal_plate_arm_1k.jpg
```

The app recognizes `diff`/`diffuse`/`basecolor`/`albedo` as color, `nor_gl` or
`nor_dx` as tangent-space normal, `rough` as roughness, `arm` as packed
ambient-occlusion (red), roughness (green), and metalness (blue), `ao` as
ambient occlusion, and `disp`/`height`/`bump` as a bump map. OpenGL normals are
preferred when both OpenGL and DirectX versions are present; DirectX normals
have their green channel inverted for Three.js. Explicit AO, roughness, and
metalness images take precedence over the corresponding packed ARM channels.

Use PNG, JPG/JPEG, or WebP. Base-color maps use sRGB; data maps use linear color
space. To tune the texture feature size, edit `TEXTURE_TILE_SIZE_METERS` in
`src/app.js`; it has one setting per material, shared by that material's maps so
normal and surface maps stay aligned. Values are approximate meters per repeat:
increase a value to make features larger and reduce repeats, or lower it for
denser tiling. Missing maps keep the existing procedural material appearance.

The View panel's **Load HDRI** button accepts local equirectangular `.hdr` or
`.exr` environment images. The selected image is used as the visible sky and is
converted to a filtered environment map for material reflections. Use
**Procedural** to return to the generated sky.
