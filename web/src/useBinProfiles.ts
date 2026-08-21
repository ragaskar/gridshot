import { useEffect, useState } from "react";
import { listBinProfiles, type BinProfile } from "./api";

/** Every saved Bin Profile, fetched once per mount. Shared by every picker
 *  that offers "apply a profile" — the picker itself decides what to do
 *  with the fields (a one-time copy into local state, never a live
 *  reference), this hook only fetches the list. */
export function useBinProfiles(): BinProfile[] {
  const [profiles, setProfiles] = useState<BinProfile[]>([]);
  useEffect(() => {
    listBinProfiles().then(setProfiles).catch(() => {});
  }, []);
  return profiles;
}
