// Desktop / simulator entry point. No QR hardware here: use the control panel's
// equipment picker, then "Simulate marker" (or press M) to place the tool in front of you.
using MiChips.Cleanroom;

AppBootstrap.Run(new SimulatedMarkerSource());
