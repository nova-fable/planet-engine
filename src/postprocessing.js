/**
 * postprocessing.js — 后处理管线
 *
 * EffectComposer + RenderPass + UnrealBloomPass + OutputPass。
 * Bloom 是让等离子/线圈/灯带读作"霓虹"的关键：
 *   dark  —— 阈值 0.62 / 强度 0.85 / 半径 0.5
 *   light —— 阈值 0.72 / 强度 0.35 / 半径 0.5（白模下不能过曝）
 */

import * as THREE from '../vendor/three.module.js';
import { EffectComposer } from '../vendor/addons/EffectComposer.js';
import { RenderPass } from '../vendor/addons/RenderPass.js';
import { UnrealBloomPass } from '../vendor/addons/UnrealBloomPass.js';
import { OutputPass } from '../vendor/addons/OutputPass.js';

export const BLOOM_PRESETS = {
  dark: { strength: 0.85, radius: 0.5, threshold: 0.62 },
  // 白模主题：材质为中灰调，阈值略降以保留等离子辉光，但强度大幅压低避免过曝
  light: { strength: 0.35, radius: 0.5, threshold: 0.55 },
};

/**
 * 创建后处理管线。
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 */
export function createPostFX(renderer, scene, camera) {
  if (!renderer) throw new Error('[postfx] 需要有效的 renderer');

  const size = renderer.getSize(new THREE.Vector2());
  let width = size.x || 1;
  let height = size.y || 1;
  const pixelRatio = Math.max(1, renderer.getPixelRatio ? renderer.getPixelRatio() : 1);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio?.(pixelRatio);
  composer.setSize(width, height);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const preset = BLOOM_PRESETS.dark;
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    preset.strength,
    preset.radius,
    preset.threshold,
  );
  composer.addPass(bloomPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  let theme = 'dark';
  let disposed = false;

  return {
    composer,
    renderPass,
    bloomPass,
    outputPass,

    /**
     * 渲染一帧。
     * @param {number} [dt] 秒（当前 UnrealBloomPass 不需要，保留以供扩展）
     */
    render(dt) {
      if (disposed) return;
      composer.render(dt);
    },

    /**
     * 尺寸变化。
     * @param {number} w CSS 像素宽
     * @param {number} h CSS 像素高
     */
    setSize(w, h) {
      if (disposed) return;
      width = Math.max(1, Math.floor(w || 1));
      height = Math.max(1, Math.floor(h || 1));
      const pr = Math.max(1, renderer.getPixelRatio ? renderer.getPixelRatio() : 1);
      composer.setPixelRatio?.(pr);
      composer.setSize(width, height);
      bloomPass.setSize(width, height);
    },

    /** 直接设置 bloom 强度 */
    setBloom(strength) {
      if (disposed) return;
      bloomPass.strength = Math.max(0, Number(strength) || 0);
    },

    /** 按主题切换 bloom 参数 */
    setTheme(mode) {
      if (disposed) return;
      theme = mode === 'light' ? 'light' : 'dark';
      const p = BLOOM_PRESETS[theme];
      bloomPass.strength = p.strength;
      bloomPass.radius = p.radius;
      bloomPass.threshold = p.threshold;
    },

    get theme() { return theme; },
    get size() { return { width, height, pixelRatio }; },

    dispose() {
      if (disposed) return;
      disposed = true;
      try { bloomPass.dispose?.(); } catch (e) { /* ignore */ }
      try { outputPass.dispose?.(); } catch (e) { /* ignore */ }
      try { renderPass.dispose?.(); } catch (e) { /* ignore */ }
      try { composer.dispose?.(); } catch (e) { /* ignore */ }
      try { composer.renderTarget1?.dispose?.(); } catch (e) { /* ignore */ }
      try { composer.renderTarget2?.dispose?.(); } catch (e) { /* ignore */ }
      try { composer.copyPass?.dispose?.(); } catch (e) { /* ignore */ }
    },
  };
}

export default { createPostFX, BLOOM_PRESETS };
