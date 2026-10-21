// Atmosphere: height + distance haze with aerial perspective, injected into three's fog chunks (FogExp2 path).
// Every material with fog: true (MeshStandardMaterial default, the lake ShaderMaterial) gets it automatically —
// no per-material plumbing. scene.fog.density = ground-level extinction (1/m), scene.fog.color = horizon haze
// colour (linear). The haze colour is direction-dependent: warmer + brighter toward the sun azimuth, forward
// scattering around the sun, slightly bluer for paths high above the ground (Rayleigh at altitude).
// Must be imported before any material compiles.
import * as THREE from 'three';
import { SUN } from '../../src/lib/world.js';

const S = SUN.clone().normalize();
const f = (v) => v.toFixed(5);
THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogWorld;
#endif`;
THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogWorld = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );
#endif`;
THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorld;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;
THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
	#ifdef FOG_EXP2
	{
		const vec3 bqSun = vec3( ${f(S.x)}, ${f(S.y)}, ${f(S.z)} );
		const float bqH = 420.0;                       // haze scale height (m)
		vec3 bqRay = vFogWorld - cameraPosition; float bqDist = length( bqRay ); vec3 bqDir = bqRay / max( bqDist, 1e-3 );
		float y0 = max( cameraPosition.y, 0.0 ), y1 = max( vFogWorld.y, 0.0 ), dy = y1 - y0;
		float e0 = exp( - y0 / bqH );
		float k = abs( dy ) > 1.0 ? ( e0 - exp( - y1 / bqH ) ) * bqH / dy : e0;
		float T = exp( - fogDensity * max( bqDist - 400.0, 0.0 ) * k );   // clear air in the first 400 m
		float az = max( dot( normalize( bqDir.xz + 1e-5 ), normalize( bqSun.xz ) ), 0.0 );
		float mu = max( dot( bqDir, bqSun ), 0.0 );
		vec3 hz = fogColor * ( 0.88 + 0.30 * az * az * az ) + vec3( 1.0, 0.72, 0.42 ) * ( pow( mu, 10.0 ) * 0.30 );
		float alt = smoothstep( 120.0, 1500.0, 0.5 * ( y0 + y1 ) );
		hz = mix( hz, vec3( 0.60, 0.66, 0.76 ), alt * 0.38 );
		gl_FragColor.rgb = gl_FragColor.rgb * T + hz * ( 1.0 - T );
	}
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
	#endif
#endif`;

// haze + dust coupling. dz = st.dz from updateWorld (0 clear .. ~0.8 heavy dust)
const HAZE = new THREE.Color().setRGB(0.84, 0.64, 0.45), DUSTH = new THREE.Color().setRGB(0.74, 0.60, 0.47);
export function makeAtmosphere({ density = 0.00013 } = {}) {
  const A = { density, enabled: true };
  A.update = (scene, dz) => {
    if (!scene.fog) return;
    // dubai.js already copied its own (exp²) fog values into the dust sprites — they keep that; opaque geometry gets this haze
    scene.fog.color.copy(HAZE).lerp(DUSTH, Math.min(1, dz * 1.2));
    scene.fog.density = A.enabled ? A.density * (1 + dz * 3.2) : 0;
  };
  return A;
}
