# Literature review

Short review of the background used in this project. The same material, with the reference list, is Section II of the IEEE report
(`report/IEEE_Report_Final.pdf`).

## Caches and the memory wall
Processor speed has grown much faster than DRAM speed, so a program that went to main memory for every access would mostly wait
(Wulf and McKee, 1995). A cache keeps copies of recently used data in a small, fast memory. It works because programs show
*temporal locality* (data used now is used again soon) and *spatial locality* (nearby data is used soon), so a miss fetches a whole block.
Smith's survey (1982) describes the basic design choices: block size, mapping, replacement and write policy. The standard performance
model is AMAT = hit time + miss rate x miss penalty (Hennessy and Patterson; Patterson and Hennessy).

## Mapping and conflict misses
In a direct-mapped cache every memory block has exactly one possible line, so a lookup is one tag comparison and no replacement policy is needed.
Hill (1988) argued that this speed and simplicity can make direct-mapped caches the better design overall. Hill and Smith (1989) measured how miss rate
falls with associativity and showed that conflict misses are the main reason direct-mapped caches miss more. A small fully-associative victim cache
removes many of these conflicts (Jouppi, 1990). This project implements the direct-mapped design and shows conflict misses with test 4
(addresses 0 and 1024) and test 12 (100, 1124, 100, 104).

## Blocking and non-blocking caches
The controller handles one request at a time. Kroft (1981) introduced the lockup-free cache that keeps serving requests while a miss is outstanding; this is listed as future work.

## Cache simulators
Dinero IV (Edler and Hill) and gem5 (Binkert et al., 2011) model cache behaviour in software and are good for studying many configurations.
They do not contain the hardware description. Here the cache is a Verilog design, so cycle counts and signals come from the RTL.

## Verilog tools and verification
Verilog is defined by IEEE Std 1364-2005, which also defines the Value Change Dump (VCD) waveform format. Icarus Verilog simulates the design and writes VCD
files, GTKWave displays them, and Yosys synthesizes the design to estimate hardware cost. To test whether a testbench is strong, small bugs can be injected
into the design to see whether the tests fail; this is mutation testing (DeMillo, Lipton and Sayward, 1978). The project uses it on the controller and its modules.

## References
1. W. A. Wulf and S. A. McKee, "Hitting the memory wall: Implications of the obvious," *ACM SIGARCH Comput. Archit. News*, vol. 23, no. 1, pp. 20-24, 1995.
2. J. L. Hennessy and D. A. Patterson, *Computer Architecture: A Quantitative Approach*, 6th ed., Morgan Kaufmann, 2017.
3. D. A. Patterson and J. L. Hennessy, *Computer Organization and Design: The Hardware/Software Interface, RISC-V Edition*, 2nd ed., Morgan Kaufmann, 2020.
4. A. J. Smith, "Cache memories," *ACM Computing Surveys*, vol. 14, no. 3, pp. 473-530, 1982.
5. M. D. Hill, "A case for direct-mapped caches," *Computer*, vol. 21, no. 12, pp. 25-40, 1988.
6. M. D. Hill and A. J. Smith, "Evaluating associativity in CPU caches," *IEEE Trans. Computers*, vol. 38, no. 12, pp. 1612-1630, 1989.
7. N. P. Jouppi, "Improving direct-mapped cache performance by the addition of a small fully-associative cache and prefetch buffers," *Proc. 17th ISCA*, 1990, pp. 364-373.
8. D. Kroft, "Lockup-free instruction fetch/prefetch cache organization," *Proc. 8th ISCA*, 1981, pp. 81-87.
9. J. Edler and M. D. Hill, "Dinero IV trace-driven uniprocessor cache simulator." https://pages.cs.wisc.edu/~markhill/DineroIV/
10. N. Binkert et al., "The gem5 simulator," *ACM SIGARCH Comput. Archit. News*, vol. 39, no. 2, pp. 1-7, 2011.
11. *IEEE Standard for Verilog Hardware Description Language*, IEEE Std 1364-2005, 2006.
12. S. Williams, "Icarus Verilog." https://steveicarus.github.io/iverilog/
13. "GTKWave waveform viewer." https://gtkwave.sourceforge.net/
14. C. Wolf, J. Glaser and J. Kepler, "Yosys - a free Verilog synthesis suite," *Proc. 21st Austrian Workshop on Microelectronics (Austrochip)*, 2013.
15. R. A. DeMillo, R. J. Lipton and F. G. Sayward, "Hints on test data selection: Help for the practicing programmer," *Computer*, vol. 11, no. 4, pp. 34-41, 1978.

Bibliographic details were written from memory; check them against the originals before formal submission.
