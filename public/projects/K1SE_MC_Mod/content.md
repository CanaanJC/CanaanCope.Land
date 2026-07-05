[P1a]
# Goals
I have been 3d Printing for about 4 years now. It's about time I branch out to do multi color printing. There is a [commercially available option](https://store.creality.com/ca/products/creality-cfs-c) provided by Creatily but it is simply way too expensive ($449CAD as of 2026/05/18).

Thus, my goals are simple. Enable multi material printing on my K1SE printer with home made hardware for as cheap as possible. 

# Preparations
In the early fall of 2025, a good friend of mine mentioned that he saw an interesting [video](https://youtu.be/s264WtPAhXw) on the possibility of creating a home made MMU `(Multi Material Unit)`. This inspired us to create our own from scratch. 
[M1] fig1.png [/M1]
We established a plan. We'd both buy parts for our respective MMUs and build them when he came for a visit on his Christmas break. In Mid november, we had both made orders to AliExpress. This is a great place to get cheap parts and electronics. And I purchased a small cutting tool from Creality that goes into my printers tool head. 

I also salvaged most of the expensive components like the logic board, stepper motors and PSU from my first ever printer that I built. It's been a parts donor for a while now. 

By December 12th, both the parts and my friend had arrived. Time to get to work.

[/P1a]
[P1b]
fig1.png
[/P1b]
[P2a]
./figs2
./figs3
[/P2a]
[P2b]
# Splitter
The Splitter is one of the most important parts of the build. It has 5 inputs at the top for the deferent input materials and 1 output at the bottom. I actually printed 3 of these. The first 2 were ruined when getting it Prepared. The tubes were initially too tight so we used pliers to force one through. Then you just need to keep passing it back and forth to break it in. But the first 2 got filament stuck inside with no way to remove it. We really tried to extract it, but it was no use. 
[M1] ./figs2 [/M1]
# Motor Mounts
To mount the motors, I designed and printed this large mounting bracket. It fits with the contours along the edges of the printers frame. It was actually way too form fitting. Took 2 of us putting our full body weight into it to get it to snap into place. 
# Stand Offs
The Parts that I need to mount on the back here have uneven surfaces. So I printed stand offs. This actually helped a lot with cable management as I was able to feed them under the splitter and PSU. 
[M1] ./figs3 [/M1]

Originally I was not going to do stand offs for the power supply since it had screw holes on the back. Unfortunately with no pressure at all it stripped. The PSU, as it turns out, is a very soft metal. Anyways after a quick trip to the hardware store for 4mm bolts and carefully tearing down the PSU, I got it firmly mounted to the back of the printer. 
[/P2b]
[P3a]
# Logic Board
Luckily I had a spare [Ramps 1.4](https://reprap.org/wiki/RAMPS_1.4) lying around. Well not really. It was part of my old Prusa i3 clone I had rebuilt. All the motors and the ramps for this project came from this. So in a sense I've combined my printers. 
[M1] fig4.png [/M1]

Anyways after getting this with stand offs it fits super nicely in the bottom corner. 

By the way, that USB hub in the bottom left there is not stock. The printer only came with a single USB port. So I wired in a 6 port USB hub. The other half is inside and it has the USB camera plugged into it there.

For more information about that modification you can see it [here](https://canaancope.land/small-projects/K1SE_USB_mod)

# End Stop Wiring

End stops are super important for this. The software needs to know if the colors were successfully loaded or not. Otherwise it can cause failed prints or printer damage. 

To set this up I used end stop switches mounted in the print with a ball. As the filament passes through the splitter, it raises the ball into the switch. 

To get them all wired up, I set them up in a 3 pin configuration. That means that all switches have a positive, negative and signal wire hooked up. 
<fig6.png>
[M1] fig6.png [/M1]
I got some wire that already had female connectors from my old Prusa and wired it up with a common `+/-`. Wiring a new wire to each `+/-` is needlessly complicated so this worked well. 

Stripping wire in a mid-section of wire without breaking the wire proved difficult. So what I did was simply touch the soldering iron to the wire and burn off the insulation jacket. Then just tack on some flux and solder. With that done I just had to solder up 5 signal wires. With that all done, everything electrical was working perfectly. 
[M1] ./figs5 [/M1]
[/P3a]
[P3b]
<fig4.png>
<./figs5>
[/P3b]
[P4a]
<./figs7>
<fig8.png>
[/P4a]
[P4b]
# Power Delivery
This PSU had no power socket and expected ground, power and neutral lines, but I wanted better than that. So I grabbed a switch I have had lying around and I pulled a socket out of an old computer PSU. Once I had those in hand I measured them and printed a housing. It honestly works great. 
[M1] ./figs7 [/M1]
# Cable Management and Final Touches

I was able to neatly loop the cables from the steppers underneath the splitter, under the ramps and up to the plugs. It actually turned out that it was PERFECT. It's snug with absolutely no extra. As for the sensor wires, I also sent those under the splitter. The PSU cables were just cut short and neatly routed to the PSU screw terminals.  

Then I just routed all the bowden tubing and we are all set!
[M1] fig8.png [/M1]
[/P4b]
[P5a]
# Software
To get the new MMU (ramps board) detected by Klipper (printer's firmware), I added this to `printer.cfg`
```
[mcu mega]
serial: /dev/serial/by-id
usb-Arduino__www.arduino.cc__0042_9533335393635120A011-if00
baud: 250000
restart_method: arduino
```
Next I needed to declare the stepper motors and sensors. For this I needed to know the pin identifiers for each. This turned out to be a lot harder than it sounded. I thought you could just look up the Pin ID on a diagram, *nope*. We ended up doing a ton of random forum searching and trial and error till we found them. We needed about 26 in all.
```
#End Stops
[filament_switch_sensor filament_sensor_1]
switch_pin: mega:PE5  # X-min
pause_on_runout: False

#Steppers
[extruder_stepper x]
extruder: extruder
step_pin: mega:PF0
dir_pin: mega:PF1
enable_pin: !mega:PD7

(this is just one of each)
```
Other than that I had made a few basic macros. 

# Future Completion
Unfortunately when working on getting the macros set up and adding the MMU to the config, it messed up my entire printer. Essential macros like stop, pause and level were nonexistent and many more issues. I ended up resetting my printer and I have yet to complete the software side. Some projects came up (namely [Project SciAnnex](https://canaancope.land/CrafTech)) and others. I have a version 2 of my [Ping Pong Canon](https://canaancope.land/projects/pingpong_canon) planned and I have a lot of website work to catch up on. So at some point soonish™, I will get back to work on the software side. That said the hardware is fully complete and far surpassed expectations. 
[/P5a]
[P5b]
fig9.png
[/P5b]
[M1] fig9.png [/M1]
