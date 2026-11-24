// Independent golden model for checking (simulation only). Stores 32-bit
// words, not bytes, and never sees cache or block logic: it answers
// "what is the correct word at this byte address?".
module reference_memory #(
    parameter MEM_BYTES = 65536
) (
    input  wire [31:0] addr,       // byte address, word aligned
    output wire [31:0] rdata
);
    `include "mem_init.vh"
    reg [31:0] words [0:MEM_BYTES/4-1];
    integer w;
    initial for (w = 0; w < MEM_BYTES/4; w = w + 1)
        words[w] = {init_byte(4*w+3), init_byte(4*w+2), init_byte(4*w+1), init_byte(4*w)};
    assign rdata = words[addr[31:2]];
endmodule
