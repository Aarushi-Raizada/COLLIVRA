"use client";

import { useState, useEffect } from "react";
import * as THREE from "three";

export interface EarthTexturesState {
  dayMap: THREE.Texture | null;
  nightMap: THREE.Texture | null;
  cloudsMap: THREE.Texture | null;
  specularMap: THREE.Texture | null;
  isLoaded: boolean;
  hasError: boolean;
}

// Global texture cache to prevent reloading across module navigation
let textureCache: EarthTexturesState | null = null;
let activeSubscribers = 0;

/**
 * Loads and provides cached, high-resolution NASA/Solar System Scope Earth texture maps.
 * Automatically configures sRGB color spaces and anisotropy filtering.
 */
export function useEarthTextures(): EarthTexturesState {
  const [textures, setTextures] = useState<EarthTexturesState>(() => {
    if (textureCache && textureCache.isLoaded) {
      return textureCache;
    }
    return {
      dayMap: null,
      nightMap: null,
      cloudsMap: null,
      specularMap: null,
      isLoaded: false,
      hasError: false,
    };
  });

  useEffect(() => {
    activeSubscribers++;

    if (textureCache && textureCache.isLoaded) {
      setTextures(textureCache);
      return () => {
        activeSubscribers--;
      };
    }

    if (typeof window === "undefined") {
      return () => {
        activeSubscribers--;
      };
    }

    let isMounted = true;
    const loader = new THREE.TextureLoader();

    // Configure max anisotropy support if WebGL is available
    const maxAnisotropy = 4;

    const loadTexture = (url: string, isSRGB: boolean): Promise<THREE.Texture> => {
      return new Promise((resolve, reject) => {
        loader.load(
          url,
          (tex) => {
            tex.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            tex.anisotropy = maxAnisotropy;
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
            tex.generateMipmaps = true;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
            resolve(tex);
          },
          undefined,
          (err) => reject(err)
        );
      });
    };

    Promise.all([
      loadTexture("/textures/earth/earth_day_2k.jpg", true),
      loadTexture("/textures/earth/earth_night_2k.jpg", true),
      loadTexture("/textures/earth/earth_clouds_2k.jpg", false),
      loadTexture("/textures/earth/earth_specular_2k.jpg", false),
    ])
      .then(([day, night, clouds, specular]) => {
        if (!isMounted) return;

        const state: EarthTexturesState = {
          dayMap: day,
          nightMap: night,
          cloudsMap: clouds,
          specularMap: specular,
          isLoaded: true,
          hasError: false,
        };

        textureCache = state;
        setTextures(state);
      })
      .catch((err) => {
        console.warn("[COLLIVRA] Failed to load photorealistic Earth textures, using procedural fallback:", err);
        if (isMounted) {
          setTextures((prev) => ({
            ...prev,
            hasError: true,
          }));
        }
      });

    return () => {
      isMounted = false;
      activeSubscribers--;
      // Note: We retain textureCache in memory for instant tab navigation during the session.
    };
  }, []);

  return textures;
}

