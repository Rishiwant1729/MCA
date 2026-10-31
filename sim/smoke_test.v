// Minimal toolchain check: clock, counter, waveform dump.
`timescale 1ns/1ps
module smoke_test;
    reg clk = 0;
    reg [3:0] count = 0;
    always #5 clk = ~clk;
    always @(posedge clk) count <= count + 1;
    initial begin
        $dumpfile("results/waveforms/smoke.vcd");
        $dumpvars(0, smoke_test);
        repeat (10) @(posedge clk);
        #1;
        if (count == 4'd10) begin $display("SMOKE PASS: count=%0d", count); $finish; end
        else begin $display("SMOKE FAIL: count=%0d", count); $fatal(1); end
    end
endmodule
