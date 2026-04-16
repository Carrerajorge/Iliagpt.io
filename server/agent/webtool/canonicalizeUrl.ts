import { z } from "zod";
import { validateOrThrow } from "../validation";

export const UrlStringSchema = z.string().min(1).max(8192);

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_cid",
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "twclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_",
  "source",
  "src",
  "campaign",
  "affiliate",
  "aff_id",
  "partner",
  "partner_id",
  "tracking",
  "track",
  "trk",
  "click_id",
  "clickid",
  "session_id",
  "sessionid",
  "visitor_id",
  "visitorid",
  "_ga",
  "_gl",
  "_hsenc",
  "_hsmi",
  "hsa_acc",
  "hsa_cam",
  "hsa_grp",
  "hsa_ad",
  "hsa_src",
  "hsa_tgt",
  "hsa_kw",
  "hsa_mt",
  "hsa_net",
  "hsa_ver",
  "oly_anon_id",
  "oly_enc_id",
  "s_kwcid",
  "ef_id",
  "s_cid",
  "zanpid",
  "spm",
  "scm",
  "_bta_tid",
  "_bta_c",
  "mkwid",
  "pcrid",
  "pmt",
  "pkw",
  "slid",
  "gad_source",
]);

const TRACKING_PARAM_PREFIXES = [
  "utm_",
  "fbad_",
  "fb_",
  "ga_",
  "google_",
  "bing_",
  "ad_",
  "ads_",
  "campaign_",
  "track_",
  "click_",
  "ref_",
  "__hs",
  "hsa_",
  "mc_",
];

function isTrackingParam(param: string): boolean {
  const lowerParam = param.toLowerCase();
  
  if (TRACKING_PARAMS.has(lowerParam)) {
    return true;
  }
  
  for (const prefix of TRACKING_PARAM_PREFIXES) {
    if (lowerParam.startsWith(prefix)) {
      return true;
    }
  }
  
  return false;
}

export function canonicalizeUrl(url: string): string {
  const validated = validateOrThrow(UrlStringSchema, url, "canonicalizeUrl");
  
  let parsedUrl: URL;
  try {
    let normalizedUrl = validated.trim();
    
    if (!normalizedUrl.match(/^https?:\/\//i)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new Error(`Invalid URL format: ${url}`);
  }
  
  parsedUrl.protocol = parsedUrl.protocol.toLowerCase();
  
  parsedUrl.hostname = parsedUrl.hostname.toLowerCase();
  
  if (parsedUrl.hostname.startsWith("www.")) {
    parsedUrl.hostname = parsedUrl.hostname.slice(4);
  }
  
  if (
    (parsedUrl.protocol === "http:" && parsedUrl.port === "80") ||
    (parsedUrl.protocol === "https:" && parsedUrl.port === "443")
  ) {
    parsedUrl.port = "";
  }
  
  const cleanParams = new URLSearchParams();
  const sortedParams: [string, string][] = [];
  
  parsedUrl.searchParams.forEach((value, key) => {
    if (!isTrackingParam(key)) {
      sortedParams.push([key, value]);
    }
  });
  
  sortedParams.sort((a, b) => a[0].localeCompare(b[0]));
  
  for (const [key, value] of sortedParams) {
    cleanParams.append(key, value);
  }
  
  parsedUrl.search = cleanParams.toString() ? `?${cleanParams.toString()}` : "";
  
  parsedUrl.hash = "";
  
  let pathname = parsedUrl.pathname;
  
  pathname = pathname.replace(/\/+/g, "/");
  
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  
  pathname = pathname
    .split("/")
    .map((segment) => {
      try {
        const decoded = decodeURIComponent(segment);
        return encodeURIComponent(decoded);
      } catch {
        return segment;
      }
    })
    .join("/");
  
  parsedUrl.pathname = pathname;
  
  return parsedUrl.toString();
}

export function extractDomain(url: string): string {
  try {
    const parsedUrl = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isSameOrigin(url1: string, url2: string): boolean {
  try {
    const parsed1 = new URL(url1.startsWith("http") ? url1 : `https://${url1}`);
    const parsed2 = new URL(url2.startsWith("http") ? url2 : `https://${url2}`);
    return parsed1.origin === parsed2.origin;
  } catch {
    return false;
  }
}
