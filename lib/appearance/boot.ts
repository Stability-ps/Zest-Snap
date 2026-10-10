import { ACCENTS, THEME_COLOR } from "./palette";
import { APPEARANCE_KEY } from "./preferences";

/**
 * Inline <head> script: applies the stored appearance before the first paint so a dark-mode start never
 * flashes white and an accent never flashes blue. Must stay dependency-free and must never throw.
 * Kept in sync with ./client.ts applyAppearance(); tests/appearance.test.ts runs both against the same cases.
 */
export const APPEARANCE_BOOT_SCRIPT = `(function(){try{
var d=document.documentElement,m="system",a="ocean",A=${JSON.stringify(ACCENTS.map((x) => x.id))};
if(/^\\/admin(\\/|$)/.test(location.pathname)){d.dataset.theme="light";return}
try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(APPEARANCE_KEY)})||"null");
if(s&&(s.mode==="light"||s.mode==="dark"||s.mode==="system"))m=s.mode;
if(s&&A.indexOf(s.accent)>=0)a=s.accent}catch(e){}
var dark=m==="dark"||(m==="system"&&window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches);
d.dataset.theme=dark?"dark":"light";d.dataset.themeMode=m;
if(a!=="ocean")d.dataset.accent=a;
var c=dark?${JSON.stringify(THEME_COLOR.dark)}:${JSON.stringify(THEME_COLOR.light)};
var t=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<t.length;i++){t[i].setAttribute("content",c);t[i].removeAttribute("media")}
}catch(e){}})();`;
