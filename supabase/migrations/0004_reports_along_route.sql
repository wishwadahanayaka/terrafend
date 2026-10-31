-- Finds active reports near a route, in the order you'd reach them.
-- The route is the GeoJSON LineString built from the routing Edge Function's
-- coordinates: { "type": "LineString", "coordinates": [[lng, lat], ...] }.

create function public.reports_along_route(
  route    jsonb,
  buffer_m double precision default 150
)
returns table (
  id                    uuid,
  hazard_type           text,
  severity              text,
  note                  text,
  lat                   double precision,
  lng                   double precision,
  created_at            timestamptz,
  expires_at            timestamptz,
  photo_path            text,
  distance_along_m      double precision,
  distance_from_route_m double precision
)
language plpgsql
stable
-- Not security definer: it runs as the caller, so the read policy on reports
-- still hides expired and cleared ones.
set search_path = public, extensions
as $$
declare
  line      geometry;
  line_geog geography;
  points    integer;
begin
  -- Checked before parsing, so an oversized input is rejected cheaply.
  -- 22023 is "invalid parameter value", which the API returns as a 400.
  if route is null or jsonb_typeof(route) <> 'object' or route ->> 'type' is distinct from 'LineString' then
    raise exception 'route must be a GeoJSON LineString' using errcode = '22023';
  end if;
  if jsonb_typeof(route -> 'coordinates') is distinct from 'array' then
    raise exception 'route needs a coordinates array' using errcode = '22023';
  end if;

  points := jsonb_array_length(route -> 'coordinates');
  if points < 2 or points > 20000 then
    raise exception 'route must have between 2 and 20000 points' using errcode = '22023';
  end if;

  if buffer_m is null or buffer_m < 25 or buffer_m > 500 then
    raise exception 'buffer_m must be between 25 and 500' using errcode = '22023';
  end if;

  line := st_setsrid(st_geomfromgeojson(route::text), 4326);
  line_geog := line::geography;

  -- ST_DWithin on geography works in metres and can use the spatial index on
  -- reports.location. The fraction along the line is found on the flat
  -- geometry, then the part of the route up to that point is measured in
  -- metres on the earth's surface.
  return query
  with nearby as (
    select r.*,
           st_linelocatepoint(line, r.location::geometry) as fraction
      from public.reports r
     where st_dwithin(r.location, line_geog, buffer_m)
  )
  select n.id, n.hazard_type, n.severity, n.note,
         st_y(n.location::geometry), st_x(n.location::geometry),
         n.created_at, n.expires_at, n.photo_path,
         st_length(st_linesubstring(line, 0, n.fraction)::geography),
         st_distance(n.location, line_geog)
    from nearby n
   order by n.fraction
   limit 200;
end;
$$;

revoke all on function public.reports_along_route(jsonb, double precision) from public;
grant execute on function public.reports_along_route(jsonb, double precision) to anon, authenticated;
