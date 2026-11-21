# ZORBIT Planetary Texture Assets & Licensing Attribution

This directory bundles locally hosted 2K ($2048 \times 1024$) equirectangular planetary texture maps for the ZORBIT Photorealistic Earth & Atmosphere Engine. All assets are bundled directly within the repository to enable 100% offline rendering without external network requests at runtime.

---

## 1. Texture Provider & Licensing Manifest

| Asset File | Resolution | Format | Size | Description | Texture Provider & Source | Applicable License |
| :--- | :---: | :---: | :---: | :--- | :--- | :--- |
| `earth_day_2k.jpg` | $2048 \times 1024$ | JPEG | 452 KB | Global equirectangular daytime surface map showing continental topography, vegetation gradients, and ocean bathymetry. | **Solar System Scope**<br>Source: https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg<br>Base Data: NASA Visible Earth / MODIS | [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/) |
| `earth_night_2k.jpg` | $2048 \times 1024$ | JPEG | 249 KB | Global nocturnal city lights map (Black Marble) displaying urban illumination. | **Solar System Scope**<br>Source: https://www.solarsystemscope.com/textures/download/2k_earth_nightmap.jpg<br>Base Data: NASA / Suomi NPP VIIRS | [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/) |
| `earth_clouds_2k.jpg` | $2048 \times 1024$ | JPEG | 943 KB | Global satellite cloud coverage map with transparent alpha blending for multi-layer cloud sphere rendering. | **Solar System Scope**<br>Source: https://www.solarsystemscope.com/textures/download/2k_earth_clouds.jpg<br>Base Data: NASA Earth Observatory | [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/) |
| `earth_specular_2k.jpg` | $2048 \times 1024$ | JPEG | 218 KB | Water/land reflectivity mask (ocean gloss specular reflectance vs continental absorption). | **Three.js Project**<br>Source: https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_specular_2048.jpg<br>Base Data: NASA Goddard Space Flight Center | [MIT License](https://github.com/mrdoob/three.js/blob/master/LICENSE) |

---

## 2. Terms of Use & Licensing Details

### Solar System Scope Textures (CC BY 4.0)
- **Texture Provider:** [Solar System Scope](https://www.solarsystemscope.com/textures/)
- **License:** [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
- **Attribution Statement:** The daytime surface (`earth_day_2k.jpg`), nighttime city lights (`earth_night_2k.jpg`), and cloud coverage (`earth_clouds_2k.jpg`) textures are created and distributed by Solar System Scope. While derived from NASA and NOAA satellite imagery, these processed texture maps are copyrighted works of Solar System Scope provided under the CC BY 4.0 license. They are not NASA public-domain assets.
- **Modification & Processing Disclosure:** The files are bundled in their original 2K ($2048 \times 1024$) equirectangular format, served statically by Next.js, and sampled in Three.js with sRGB color space conversion and anisotropic filtering.

### Three.js Ocean Specular Mask (MIT License)
- **Source:** [mrdoob/three.js Planetary Assets](https://github.com/mrdoob/three.js/tree/master/examples/textures/planets)
- **License:** [MIT License](https://github.com/mrdoob/three.js/blob/master/LICENSE) (Copyright (c) 2010-2026 three.js authors)
- **Attribution:** Water/land mask derived from NASA Blue Marble observations and distributed under the MIT License by the Three.js open-source project.
