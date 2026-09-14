-- IN THE VOID — Interactive Dragon controls
-- Isolated namespace: dragon_* only.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dragon_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  target_type text NOT NULL DEFAULT 'all' CHECK (target_type IN ('all','selected')),
  default_device_mode text NOT NULL DEFAULT 'both' CHECK (default_device_mode IN ('mobile','desktop','both')),
  admin_enabled boolean NOT NULL DEFAULT true,
  admin_device_mode text NOT NULL DEFAULT 'both' CHECK (admin_device_mode IN ('mobile','desktop','both')),
  members_control_available boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.dragon_settings (id, enabled, target_type, default_device_mode, admin_enabled, admin_device_mode, members_control_available)
VALUES (1, true, 'all', 'both', true, 'both', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.dragon_user_settings (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  allowed boolean NOT NULL DEFAULT true,
  control_enabled boolean NOT NULL DEFAULT false,
  user_enabled boolean NOT NULL DEFAULT true,
  device_mode text NOT NULL DEFAULT 'both' CHECK (device_mode IN ('mobile','desktop','both')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dragon_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dragon_user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dragon_settings_no_direct_select ON public.dragon_settings;
DROP POLICY IF EXISTS dragon_settings_no_direct_insert ON public.dragon_settings;
DROP POLICY IF EXISTS dragon_settings_no_direct_update ON public.dragon_settings;
DROP POLICY IF EXISTS dragon_settings_no_direct_delete ON public.dragon_settings;
DROP POLICY IF EXISTS dragon_user_settings_no_direct_select ON public.dragon_user_settings;
DROP POLICY IF EXISTS dragon_user_settings_no_direct_insert ON public.dragon_user_settings;
DROP POLICY IF EXISTS dragon_user_settings_no_direct_update ON public.dragon_user_settings;
DROP POLICY IF EXISTS dragon_user_settings_no_direct_delete ON public.dragon_user_settings;

CREATE POLICY dragon_settings_no_direct_select ON public.dragon_settings FOR SELECT TO authenticated USING (false);
CREATE POLICY dragon_settings_no_direct_insert ON public.dragon_settings FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY dragon_settings_no_direct_update ON public.dragon_settings FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY dragon_settings_no_direct_delete ON public.dragon_settings FOR DELETE TO authenticated USING (false);

CREATE POLICY dragon_user_settings_no_direct_select ON public.dragon_user_settings FOR SELECT TO authenticated USING (false);
CREATE POLICY dragon_user_settings_no_direct_insert ON public.dragon_user_settings FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY dragon_user_settings_no_direct_update ON public.dragon_user_settings FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY dragon_user_settings_no_direct_delete ON public.dragon_user_settings FOR DELETE TO authenticated USING (false);

CREATE OR REPLACE FUNCTION public.dragon_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role IN ('admin','super_admin'));
$$;
GRANT EXECUTE ON FUNCTION public.dragon_is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.dragon_admin_get_settings()
RETURNS TABLE(enabled boolean, target_type text, default_device_mode text, admin_enabled boolean, admin_device_mode text, members_control_available boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT enabled,target_type,default_device_mode,admin_enabled,admin_device_mode,members_control_available
  FROM public.dragon_settings WHERE id=1 AND public.dragon_is_admin();
$$;
GRANT EXECUTE ON FUNCTION public.dragon_admin_get_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.dragon_admin_set_settings(
  p_enabled boolean,
  p_target_type text,
  p_default_device_mode text,
  p_admin_enabled boolean,
  p_admin_device_mode text,
  p_members_control_available boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.dragon_is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  UPDATE public.dragon_settings
  SET enabled=COALESCE(p_enabled,false),
      target_type=CASE WHEN lower(coalesce(p_target_type,'all')) IN ('all','selected') THEN lower(p_target_type) ELSE 'all' END,
      default_device_mode=CASE WHEN lower(coalesce(p_default_device_mode,'both')) IN ('mobile','desktop','both') THEN lower(p_default_device_mode) ELSE 'both' END,
      admin_enabled=COALESCE(p_admin_enabled,false),
      admin_device_mode=CASE WHEN lower(coalesce(p_admin_device_mode,'both')) IN ('mobile','desktop','both') THEN lower(p_admin_device_mode) ELSE 'both' END,
      members_control_available=COALESCE(p_members_control_available,false),
      updated_at=now()
  WHERE id=1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.dragon_admin_set_settings(boolean,text,text,boolean,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.dragon_admin_set_user(
  p_user_id uuid,
  p_allowed boolean,
  p_control_enabled boolean,
  p_device_mode text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.dragon_is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_user_id) THEN RAISE EXCEPTION 'user not found'; END IF;
  INSERT INTO public.dragon_user_settings(user_id,allowed,control_enabled,user_enabled,device_mode,updated_at)
  VALUES (p_user_id,COALESCE(p_allowed,false),COALESCE(p_control_enabled,false),true,
          CASE WHEN lower(coalesce(p_device_mode,'both')) IN ('mobile','desktop','both') THEN lower(p_device_mode) ELSE 'both' END,now())
  ON CONFLICT (user_id) DO UPDATE SET
      allowed=EXCLUDED.allowed,
      control_enabled=EXCLUDED.control_enabled,
      device_mode=EXCLUDED.device_mode,
      updated_at=now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.dragon_admin_set_user(uuid,boolean,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.dragon_admin_get_user_settings(p_user_id uuid)
RETURNS TABLE(user_id uuid, allowed boolean, control_enabled boolean, user_enabled boolean, device_mode text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT d.user_id,d.allowed,d.control_enabled,d.user_enabled,d.device_mode
  FROM public.dragon_user_settings d
  WHERE d.user_id=p_user_id AND public.dragon_is_admin();
$$;
GRANT EXECUTE ON FUNCTION public.dragon_admin_get_user_settings(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.dragon_set_my_enabled(p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT COALESCE((SELECT s.members_control_available FROM public.dragon_settings s WHERE s.id=1),false)
     OR NOT COALESCE((SELECT d.control_enabled FROM public.dragon_user_settings d WHERE d.user_id=auth.uid()),false) THEN
    RAISE EXCEPTION 'dragon self control is not available';
  END IF;
  UPDATE public.dragon_user_settings
  SET user_enabled=COALESCE(p_enabled,true), updated_at=now()
  WHERE user_id=auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dragon self control is not configured for this user';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.dragon_set_my_enabled(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.dragon_get_my_controls()
RETURNS TABLE(show_dragon boolean, control_available boolean, user_enabled boolean, device_mode text, is_admin boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  s public.dragon_settings%ROWTYPE;
  d public.dragon_user_settings%ROWTYPE;
  a boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  SELECT * INTO s FROM public.dragon_settings WHERE id=1;
  a := public.dragon_is_admin();
  IF a THEN
    RETURN QUERY SELECT
      COALESCE(s.enabled,false) AND COALESCE(s.admin_enabled,false),
      false,
      true,
      COALESCE(s.admin_device_mode,'both'),
      true;
    RETURN;
  END IF;
  SELECT * INTO d FROM public.dragon_user_settings WHERE user_id=auth.uid();
  IF NOT COALESCE(s.enabled,false) THEN
    RETURN QUERY SELECT false,false,COALESCE(d.user_enabled,true),COALESCE(d.device_mode,s.default_device_mode),false; RETURN;
  END IF;
  IF s.target_type='selected' AND NOT COALESCE(d.allowed,false) THEN
    RETURN QUERY SELECT false,false,COALESCE(d.user_enabled,true),COALESCE(d.device_mode,s.default_device_mode),false; RETURN;
  END IF;
  RETURN QUERY SELECT
    COALESCE(d.user_enabled,true),
    COALESCE(s.members_control_available,false) AND COALESCE(d.control_enabled,false),
    COALESCE(d.user_enabled,true),
    CASE WHEN d.user_id IS NOT NULL THEN d.device_mode ELSE s.default_device_mode END,
    false;
END;
$$;
GRANT EXECUTE ON FUNCTION public.dragon_get_my_controls() TO authenticated;

COMMIT;
