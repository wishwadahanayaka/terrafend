<!--
Draft GitHub issue for https://github.com/shakee93/sl-water-levels
NOT POSTED. Read it, edit it, and post it yourself if you are happy with it.
Delete this comment before posting.
-->

**Title:** Questions about /api/rain-map: CORS header, units and grid positions

Hi Shakeeb,

Thank you for building Sri Lanka Water Levels and for making the data easy to reach. I'm a student building [TerraFend](https://terrafend.vercel.app) ([source](https://github.com/wishwadahanayaka/terrafend)), a free hazard map for Sri Lanka that shows river levels, rain and road blockages for people travelling. It uses your `/api/levels` and `/api/rain-map` endpoints, and it credits Sri Lanka Water Levels on every river and rain card and in the README, with a link to [waterlevels.lk](https://waterlevels.lk) and to this repo. If you would like the credit worded differently, just tell me and I'll change it.

I have three small questions about `/api/rain-map`. No rush, and I'm happy with "no" to any of them.

**1. Could `/api/rain-map` send the same CORS header as `/api/levels`?**
`/api/levels` answers browser requests fine, but `/api/rain-map` comes back without an `Access-Control-Allow-Origin` header, so a browser blocks it when the request comes from another site. At the moment TerraFend works around this by asking for the rain map through its own server address, which passes the request on. That works, but it adds a hop, and it would be simpler and kinder to your server if the browser could call the endpoint directly. If you are able to add the same header that `/api/levels` sends, I can remove the workaround. If you would rather not allow other sites, that is completely fine too.

**2. What are the units of the satellite values?**
The satellite hours in the response are text with comma-separated numbers, one per grid cell. When I add up 24 hours of them, the totals are about ten times what the nearby rain gauges measured, so I believe the values are **tenths of a millimetre per hour** (so a value of `25` means 2.5 mm in that hour). Is that right? And is a blank value "nothing reported for that cell" rather than "no rain"?

**3. Are the grid values cell centres or corners?**
The `grid` object has `lat0`, `lon0`, `step`, `nx` and `ny` (currently 9.95, 79.55, 0.1, 25 and 42). I'm treating `lat0` and `lon0` as the **centre** of the first cell (the north-west one), with rows going south and columns going east, and each cell covering `step` degrees around its centre. Is that how you meant it, or are those the corner of the first cell? Knowing this tells me whether the squares I draw are half a cell off.

Thanks again, and please let me know if my requests are putting any load on your server. TerraFend asks for each endpoint at most once every 10 minutes per open page, and keeps the last answer so it doesn't ask again on every tap.

Wishwa
