import { useEffect, useRef, useState } from 'react';
import { Image } from 'react-native';
import { readFoodPhoto, cacheProductPhoto } from '@/data/food/foodPhotoRepository';
import { loadProductPhoto } from '@/data/food/foodPhotoCapture';
import { isProductPhotoUrl, type FoodPhotoOwner } from '@/data/food/foodPhotoPolicy';
import { useDataContext } from '@/providers/DataProvider';

export function FoodPhoto({ owner, remoteUrl, size = 48, wide = false, label = 'Food photo' }: {
  owner: FoodPhotoOwner; remoteUrl?: string; size?: number; wide?: boolean; label?: string;
}) {
  const { ownerIdentity, demoMode, revision } = useDataContext();
  const [state, setState] = useState<{ key: string; uri?: string }>();
  const attempted = useRef<string | undefined>(undefined);
  const key = `${ownerIdentity}:${owner.kind}:${owner.id}:${remoteUrl ?? ''}`;
  const kind = owner.kind, id = owner.id;
  useEffect(() => {
    let active = true;
    if (demoMode) return;
    void (async () => {
      const photo = await readFoodPhoto({ kind, id });
      if (!active) return;
      if (photo) { setState({ key, uri: photo.uri }); return; }
      setState({ key });
      if (kind === 'food' && remoteUrl && isProductPhotoUrl(remoteUrl) && attempted.current !== key) {
        attempted.current = key;
        const uri = await cacheProductPhoto({ kind, id }, () => loadProductPhoto(remoteUrl), remoteUrl);
        if (active) setState({ key, uri });
      }
    })().catch(() => { /* Missing/offline photos never prevent food logging. */ });
    return () => { active = false; };
  }, [key, kind, id, remoteUrl, demoMode, revision]);
  if (demoMode || state?.key !== key || !state.uri) return null;
  return <Image accessible accessibilityLabel={label} source={{ uri: state.uri }} resizeMode={wide ? 'contain' : 'cover'} style={wide ? { width: '100%', height: size, borderRadius: 12, marginVertical: 10 } : { position: 'absolute', inset: 0, width: size, height: size, borderRadius: 10 }} />;
}
